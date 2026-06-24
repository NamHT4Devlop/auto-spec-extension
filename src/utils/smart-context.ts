/**
 * smart-context.ts
 * Intelligent context loading for multi-agent steps.
 *
 * Instead of dumping the entire KB + all source into every agent,
 * this module:
 *   1. Uses a "File Discovery Agent" to identify relevant files
 *   2. Reads only those files from disk
 *   3. Splits KB into topic-specific chunks
 *   4. Allocates context to each sub-agent based on its role
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { log } from '../logger';
import { callCopilot } from './copilot';
import { estimateTokens, truncateToTokens } from './token-budget';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextChunk {
  id: string;
  label: string;
  content: string;
  tokens: number;
  source: 'kb' | 'source' | 'git' | 'config';
}

export interface SmartContextResult {
  /** All loaded context chunks */
  chunks: ContextChunk[];
  /** Files that were identified as relevant */
  relevantFiles: string[];
  /** KB topics identified as relevant */
  relevantKBTopics: string[];
}

// ─── KB Topic Mapping ─────────────────────────────────────────────────────────

const KB_TOPIC_MAP: Record<string, string[]> = {
  'architecture':   ['01-project-structure.md', '02-tech-stack.md', '07-architecture-diagram.md', '16-architecture-patterns.md'],
  'domain':         ['04-business-domain.md', '05-domain-model.md'],
  'business-rules': ['13-business-rules.md', '10-core-flows.md'],
  'api':            ['11-api-docs.md', '05-domain-model.md'],
  'security':       ['09-auth-security.md'],
  'database':       ['08-database-schema.md'],
  'integrations':   ['14-integrations.md'],
  'conventions':    ['12-conventions.md', 'review-skills.md'],
  'errors':         ['15-error-scenarios.md', '11-error-handling.md'],
  'modules':        ['06-modules.md'],
  'entry-points':   ['03-entry-points.md'],
};

// ─── Keyword → topic map (no-LLM relevance for Q&A / investigate) ───────────────
// Lets `ask` pick only the relevant KB topics from a question without spending an
// extra model call. Matching is substring-based and intentionally generous.
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'architecture':   ['architecture', 'structure', 'layer', 'folder', 'design', 'tech stack', 'framework', 'overview'],
  'domain':         ['domain', 'entity', 'model', 'aggregate', 'business object'],
  'business-rules': ['rule', 'validation', 'policy', 'flow', 'logic', 'workflow', 'calculate', 'process'],
  'api':            ['api', 'endpoint', 'route', 'controller', 'request', 'response', 'rest', 'graphql', 'http'],
  'security':       ['auth', 'security', 'login', 'token', 'permission', 'role', 'jwt', 'password', 'oauth', 'session', 'access'],
  'database':       ['database', 'schema', 'table', 'migration', 'sql', 'query', 'db', 'column', 'index', 'orm'],
  'integrations':   ['integration', 'external', 'third party', 'third-party', 'webhook', 'queue', 'kafka', 's3', 'message'],
  'conventions':    ['convention', 'style', 'naming', 'lint', 'format', 'standard', 'pattern', 'guideline'],
  'errors':         ['error', 'exception', 'failure', 'fail', 'bug', 'crash', 'retry', 'handling', 'investigate', 'issue', 'debug', 'stack trace', 'throw'],
  'modules':        ['module', 'package', 'component', 'service', 'feature'],
  'entry-points':   ['entry', 'main', 'bootstrap', 'startup', 'index', 'cli', 'command', 'trigger'],
};

/**
 * Pick the KB topics most relevant to a free-text question — no LLM call.
 * Always includes a light base (architecture + conventions) so answers stay grounded.
 * Returns all topics if nothing matches, so the caller can fall back safely.
 */
export function selectKBTopicsForQuestion(question: string): string[] {
  const q = question.toLowerCase();
  const matched = Object.entries(TOPIC_KEYWORDS)
    .filter(([, kws]) => kws.some(kw => q.includes(kw)))
    .map(([topic]) => topic);

  if (matched.length === 0) {
    // Nothing matched — let the caller decide (it will load a broad, capped set).
    return Object.keys(KB_TOPIC_MAP);
  }
  return [...new Set([...matched, 'architecture', 'conventions'])];
}

/** List per-module KB docs (knowledge-base/modules/*.md), excluding the index. */
export function listModuleDocs(workspaceRoot: string, kbRelPath: string): { name: string; file: string }[] {
  const dir = path.join(workspaceRoot, kbRelPath, 'modules');
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md') && f !== '_index.md')
      .map(f => ({ name: f.replace(/\.md$/, ''), file: path.join(dir, f) }));
  } catch {
    return [];
  }
}

/**
 * Load per-module KB docs whose module name appears in the question. A module doc
 * is the most relevant context for a question naming that module/feature.
 */
export function loadMatchingModuleDocs(
  workspaceRoot: string,
  kbRelPath: string,
  question: string,
  maxTokens: number,
): string {
  if (maxTokens <= 0) { return ''; }
  const q = question.toLowerCase();
  const docs = listModuleDocs(workspaceRoot, kbRelPath);
  const matched = docs.filter(d =>
    d.name.toLowerCase().split(/[-_./]+/).filter(t => t.length >= 3).some(t => q.includes(t))
  );
  if (!matched.length) { return ''; }

  const parts: string[] = [];
  let used = 0;
  for (const d of matched) {
    if (used >= maxTokens) { break; }
    let content: string;
    try { content = fs.readFileSync(d.file, 'utf-8').trim(); } catch { continue; }
    if (!content) { continue; }
    if (used + estimateTokens(content) > maxTokens) {
      content = truncateToTokens(content, maxTokens - used, d.name);
    }
    parts.push(`### [modules/${d.name}.md]\n${content}`);
    used += estimateTokens(content);
  }
  return parts.join('\n\n---\n\n');
}

/**
 * Heuristic: is a question too vague/under-specified to answer precisely?
 * Pure + cheap — used to nudge the answer toward interpretation + clarifying
 * questions instead of confidently guessing. No model call.
 */
export function isVagueQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (!q) { return true; }
  const words = q.split(/\s+/).filter(Boolean);

  // Very short questions are almost always under-specified.
  if (words.length <= 3) { return true; }

  // Mentions a concrete code target → treat as specific enough.
  const hasConcreteTarget =
    /[a-z0-9_./-]+\.(ts|tsx|js|jsx|java|py|go|rb|php|cs|sql|kt)\b/.test(q) ||
    /\b(endpoint|api|route|controller|service|module|component|function|method|class|entity|model|table|column|migration|schema|field|config)\b/.test(q);

  // Generic verbs with no concrete target and few words = vague.
  const startsGeneric = /^(fix|help|check|review|investigate|debug|explain|improve|optimi[sz]e|look|see|tell)\b/.test(q);
  if (startsGeneric && !hasConcreteTarget && words.length <= 6) { return true; }

  // Pronoun-only references ("why does this fail", "what about it").
  if (/\b(this|that|it|these|those|here|there)\b/.test(q) && !hasConcreteTarget && words.length <= 6) {
    return true;
  }

  return false;
}

/**
 * Build a KB context string limited to the given topics and a token budget.
 * Used by `ask` to avoid dumping the entire knowledge base into every question.
 */
export function loadKBForTopics(
  workspaceRoot: string,
  kbRelPath: string,
  topics: string[],
  maxTokens = 24_000,
): string {
  const loader = new SmartContextLoader();
  const { chunks } = loader.loadContext(workspaceRoot, kbRelPath, [], topics, maxTokens);
  return chunks
    .filter(c => c.source === 'kb')
    .map(c => `### [${c.label.replace(/^KB:\s*/, '')}]\n${c.content}`)
    .join('\n\n---\n\n');
}

// ─── Smart Context Loader ─────────────────────────────────────────────────────

export class SmartContextLoader {

  /**
   * Phase 1: Ask AI which files and KB topics are relevant to the requirement.
   * Returns a lightweight list — no file content loaded yet.
   */
  async discoverRelevantContext(
    requirement: string,
    workspaceRoot: string,
    kbRelPath: string,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
  ): Promise<{ files: string[]; kbTopics: string[] }> {
    log(`\n🔍 Smart Context: discovering relevant files...`);

    // Build a lightweight file tree (no content, just paths)
    const fileTree = this.buildFileTree(workspaceRoot);

    const kbTopics = Object.keys(KB_TOPIC_MAP).join(', ');

    const prompt = `\
Given this task requirement and project file tree, identify the MOST RELEVANT files and KB topics.

## REQUIREMENT
${requirement}

## PROJECT FILE TREE
${fileTree}

## AVAILABLE KB TOPICS
${kbTopics}

## INSTRUCTIONS
Return a JSON object with two arrays:
1. "files" — up to 15 most relevant source files (relative paths) to read for context
2. "kbTopics" — which KB topics are relevant (from the list above)

Focus on:
- Files that will need to be MODIFIED or that the new code depends on
- Files that contain related business logic, models, or API endpoints
- Test files that test related functionality
- Config files if the task involves configuration

Return ONLY the JSON, no other text:
\`\`\`json
{
  "files": ["src/path/to/file.ts", ...],
  "kbTopics": ["domain", "business-rules", ...]
}
\`\`\``;

    try {
      const response = await callCopilot(
        model,
        'You are a codebase navigator. Return only valid JSON.',
        prompt,
        token,
        '🔍 File Discovery',
      );

      return this.parseDiscoveryResponse(response);
    } catch {
      log(`⚠  File discovery failed — using broad context`);
      return {
        files: [],
        kbTopics: ['architecture', 'domain', 'business-rules', 'conventions'],
      };
    }
  }

  /**
   * Phase 2: Load the identified files and KB chunks into context.
   * Respects token budgets per chunk.
   */
  loadContext(
    workspaceRoot: string,
    kbRelPath: string,
    relevantFiles: string[],
    relevantKBTopics: string[],
    maxTotalTokens: number = 80_000,
  ): SmartContextResult {
    const chunks: ContextChunk[] = [];
    let usedTokens = 0;
    const perChunkBudget = Math.floor(maxTotalTokens / Math.max(1, relevantFiles.length + relevantKBTopics.length));

    // Load KB chunks first (higher value for analysis)
    for (const topic of relevantKBTopics) {
      const kbFiles = KB_TOPIC_MAP[topic] ?? [];
      for (const kbFile of kbFiles) {
        if (usedTokens >= maxTotalTokens) { break; }
        const fullPath = path.join(workspaceRoot, kbRelPath, kbFile);
        if (!fs.existsSync(fullPath)) { continue; }
        try {
          let content = fs.readFileSync(fullPath, 'utf-8').trim();
          if (!content) { continue; }

          const tokens = estimateTokens(content);
          if (usedTokens + tokens > maxTotalTokens) {
            content = truncateToTokens(content, maxTotalTokens - usedTokens, kbFile);
          }

          const chunkTokens = estimateTokens(content);
          chunks.push({
            id: `kb:${kbFile}`,
            label: `KB: ${kbFile}`,
            content,
            tokens: chunkTokens,
            source: 'kb',
          });
          usedTokens += chunkTokens;
        } catch { /* skip */ }
      }
    }

    // Load relevant source files
    for (const relPath of relevantFiles) {
      if (usedTokens >= maxTotalTokens) { break; }
      const fullPath = path.join(workspaceRoot, relPath);
      if (!fs.existsSync(fullPath)) { continue; }
      try {
        let content = fs.readFileSync(fullPath, 'utf-8').trim();
        if (!content) { continue; }

        const tokens = estimateTokens(content);
        if (usedTokens + tokens > maxTotalTokens) {
          content = truncateToTokens(content, Math.min(perChunkBudget, maxTotalTokens - usedTokens), relPath);
        }

        const chunkTokens = estimateTokens(content);
        chunks.push({
          id: `src:${relPath}`,
          label: relPath,
          content: `### FILE: ${relPath}\n\`\`\`\n${content}\n\`\`\``,
          tokens: chunkTokens,
          source: 'source',
        });
        usedTokens += chunkTokens;
      } catch { /* skip */ }
    }

    log(`✅ Smart Context: ${chunks.length} chunks loaded (~${usedTokens.toLocaleString()} tokens)`);

    return {
      chunks,
      relevantFiles,
      relevantKBTopics,
    };
  }

  /**
   * Build context string for a specific agent role.
   * Filters chunks relevant to that agent's focus area.
   */
  buildAgentContext(
    allChunks: ContextChunk[],
    focusAreas: ('kb' | 'source' | 'git' | 'config')[],
    kbTopicFilter?: string[],
    maxTokens: number = 30_000,
  ): string {
    let filtered = allChunks.filter(c => focusAreas.includes(c.source));

    // Further filter KB chunks by topic if specified
    if (kbTopicFilter && kbTopicFilter.length > 0) {
      filtered = filtered.filter(c => {
        if (c.source !== 'kb') { return true; }
        const kbFile = c.id.replace('kb:', '');
        return kbTopicFilter.some(topic => {
          const files = KB_TOPIC_MAP[topic] ?? [];
          return files.includes(kbFile);
        });
      });
    }

    // Build context string within token budget
    const parts: string[] = [];
    let tokens = 0;

    for (const chunk of filtered) {
      if (tokens + chunk.tokens > maxTokens) {
        parts.push(truncateToTokens(chunk.content, maxTokens - tokens, chunk.label));
        break;
      }
      parts.push(chunk.content);
      tokens += chunk.tokens;
    }

    return parts.join('\n\n---\n\n');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildFileTree(rootDir: string, maxDepth: number = 4): string {
    const SKIP = new Set([
      'node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
      '.next', 'coverage', 'spec-kit-sessions', 'knowledge-base',
      '.vscode', '.idea', 'vendor', 'target',
    ]);

    const lines: string[] = [];
    const walk = (dir: string, prefix: string, depth: number) => {
      if (depth > maxDepth) { return; }
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }

      entries = entries.filter(e => !e.name.startsWith('.') || e.name === '.env.example');

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        lines.push(`${prefix}${connector}${entry.name}`);

        if (entry.isDirectory() && !SKIP.has(entry.name)) {
          walk(
            path.join(dir, entry.name),
            prefix + (isLast ? '    ' : '│   '),
            depth + 1,
          );
        }
      }
    };

    walk(rootDir, '', 0);
    // Cap output to avoid token waste
    if (lines.length > 150) {
      return lines.slice(0, 150).join('\n') + `\n... (${lines.length - 150} more entries)`;
    }
    return lines.join('\n');
  }

  private parseDiscoveryResponse(raw: string): { files: string[]; kbTopics: string[] } {
    try {
      // Extract JSON from potential markdown fences
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, raw];
      const text = jsonMatch[1] ?? raw;

      // Find JSON object
      const braceStart = text.indexOf('{');
      const braceEnd = text.lastIndexOf('}');
      if (braceStart === -1 || braceEnd === -1) {
        throw new Error('No JSON found');
      }

      const parsed = JSON.parse(text.slice(braceStart, braceEnd + 1));
      return {
        files: Array.isArray(parsed.files) ? parsed.files.slice(0, 20) : [],
        kbTopics: Array.isArray(parsed.kbTopics) ? parsed.kbTopics : [],
      };
    } catch {
      return {
        files: [],
        kbTopics: ['architecture', 'domain', 'business-rules'],
      };
    }
  }
}
