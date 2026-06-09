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
  'architecture':   ['01-project-structure.md', '02-tech-stack.md', '07-architecture-diagram.md'],
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
