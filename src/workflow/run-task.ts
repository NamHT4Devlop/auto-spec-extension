/**
 * run-task.ts — Refactored to use Pipeline pattern.
 *
 * Previously a 32KB monolithic function with all 13 steps inline.
 * Now just sets up context and delegates to PipelineRunner.
 * Each step lives in src/workflow/pipeline/steps/.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '../logger';
import { loadKnowledgeBase } from '../utils/file-utils';
import { estimateTokens, truncateToTokens } from '../utils/token-budget';
import { PipelineRunner, PipelineContext, ALL_STEPS } from './pipeline';

/** Load review-skills.md from KB (preferred) or fallback to universal template */
function loadReviewSkills(workspaceRoot: string, kbRelPath: string, extensionPath: string): string {
  const kbReviewPath = path.join(workspaceRoot, kbRelPath, 'review-skills.md');
  if (fs.existsSync(kbReviewPath)) {
    const content = fs.readFileSync(kbReviewPath, 'utf-8');
    if (content.trim().length > 500) {
      log(`✅ Review skills loaded from KB: ${kbRelPath}/review-skills.md (${(content.length / 1024).toFixed(1)}KB)`);
      return content;
    }
  }
  const universalPath = path.join(extensionPath, 'resources', 'review-skills-universal.md');
  if (fs.existsSync(universalPath)) {
    const content = fs.readFileSync(universalPath, 'utf-8');
    log(`✅ Review skills loaded from extension resources (${(content.length / 1024).toFixed(1)}KB)`);
    log(`   ⚠  No KB found → Section 14 (project-specific rules) missing. Run "Generate KB" for a full review.`);
    return content;
  }
  log(`⚠  review-skills.md not found — using generic checklist`);
  return '';
}

/** Extra context injected by chat-participant (SessionMemory, Profile, Learnings) */
export interface EnrichmentContext {
  profileContext?: string;
  learningsContext?: string;
  sessionContext?: string;
  effectiveConfig?: {
    language: string;
    testCommand: string;
    knowledgeBasePath: string;
    sessionsDir: string;
    ignore: string[];
    scan: { excludeDocs: boolean; exclude: string[] };
  };
}

export async function runWorkflow(
  requirement: string,
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  extensionPath: string,
  enrichment?: EnrichmentContext,
): Promise<void> {

  // ── Config (use effective config from .autospec.yml if available) ──
  const cfg = vscode.workspace.getConfiguration('autoSpecKit');
  const lang = enrichment?.effectiveConfig?.language ?? cfg.get<string>('language', 'typescript');
  const kbRelPath = enrichment?.effectiveConfig?.knowledgeBasePath ?? cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  const testCmd = enrichment?.effectiveConfig?.testCommand ?? cfg.get<string>('testCommand', '');
  const autoApply = cfg.get<boolean>('autoApplyCode', false);
  const sessionsDir = enrichment?.effectiveConfig?.sessionsDir ?? cfg.get<string>('sessionsDir', 'spec-kit-sessions');

  // ── Token / agent tuning ────────────────────────────────────────
  const contextStrategy = cfg.get<'minimal' | 'smart' | 'full'>('agents.contextStrategy', 'smart');
  const mergeStrategy   = cfg.get<'auto' | 'ai' | 'concat' | 'structured'>('agents.mergeStrategy', 'auto');
  const maxParallelAgents = cfg.get<number>('agents.maxParallel', 3);
  // System-prompt KB budget for the 'smart' strategy (per-call savings: the system
  // prompt is reused across every step, so capping it cuts tokens dramatically).
  const systemKbTokenBudget = cfg.get<number>('agents.systemKbTokens', 10_000);

  // ── Session directory ───────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = requirement.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  const sessionDir = path.join(workspaceRoot, sessionsDir, `${ts}-${slug}`);
  fs.mkdirSync(sessionDir, { recursive: true });
  log(`✅ Session: ${sessionDir}`);

  // ── Check for resumable state ───────────────────────────────────
  const savedState = PipelineRunner.loadState(sessionDir);
  let resumeState = savedState;

  if (savedState && savedState.completedSteps.length > 0) {
    const resume = await vscode.window.showQuickPick(
      [
        { label: '🔄 Resume from checkpoint', resume: true },
        { label: '🆕 Start fresh', resume: false },
      ],
      {
        title: 'Previous session found',
        placeHolder: `${savedState.completedSteps.length} steps were completed`,
      }
    );
    if (resume === undefined) { return; }
    if (!resume.resume) { resumeState = undefined; }
  }

  // ── Load context ────────────────────────────────────────────────
  const kb = loadKnowledgeBase(workspaceRoot, kbRelPath);
  const reviewSkills = loadReviewSkills(workspaceRoot, kbRelPath, extensionPath);

  // ── Build enriched system prompt ─────────────────────────────────
  const enrichmentSections: string[] = [];

  if (enrichment?.profileContext) {
    enrichmentSections.push(`=== PROJECT PROFILE ===\n${enrichment.profileContext}`);
  }
  if (enrichment?.learningsContext) {
    enrichmentSections.push(enrichment.learningsContext);
  }
  if (enrichment?.sessionContext) {
    enrichmentSections.push(enrichment.sessionContext);
  }

  // Token optimization: the system prompt is reused on every model call across all
  // steps, so its KB footprint is multiplied ~30×. Size it by contextStrategy.
  let systemKb: string;
  if (!kb) {
    systemKb = '(No knowledge base found. Use general best practices.)';
  } else if (contextStrategy === 'minimal') {
    systemKb = '(Knowledge base omitted to save tokens — relevant context is loaded on demand per step.)';
  } else if (contextStrategy === 'full') {
    systemKb = kb;
  } else {
    // 'smart' (default) — cap the KB to a budget; steps still load relevant detail on demand.
    systemKb = estimateTokens(kb) > systemKbTokenBudget
      ? truncateToTokens(kb, systemKbTokenBudget, 'knowledge-base')
      : kb;
  }
  log(`ℹ  Context strategy: ${contextStrategy} | system KB ~${estimateTokens(systemKb).toLocaleString()} tokens | merge: ${mergeStrategy}`);

  const systemPrompt = `\
You are a senior software engineer implementing tasks inside a real codebase.

=== PROJECT KNOWLEDGE BASE ===
${systemKb}

${enrichmentSections.join('\n\n')}

=== ABSOLUTE RULES ===
1. Follow the EXACT patterns, naming conventions, and folder structure from the knowledge base.
2. When outputting source files, ALWAYS prefix each file's code block with:
   ### FILE: <exact/relative/path/to/file.ext>
3. Write complete, production-ready code — NO placeholders, NO skeleton TODOs.
4. Match the project's error handling, logging, and validation patterns exactly.
5. Language/runtime: ${lang}
6. Write all explanations in English. Write code and code comments in English.`;

  // ── Build pipeline context ──────────────────────────────────────
  const ctx: PipelineContext = {
    requirement, workspaceRoot, model, token, progress, extensionPath,
    lang, kbRelPath, testCmd, autoApply, sessionsDir,
    contextStrategy, mergeStrategy, maxParallelAgents,
    sessionDir, kb, reviewSkills, systemPrompt,
    stepOutputs: new Map(),
  };

  // ── Run pipeline ────────────────────────────────────────────────
  const runner = new PipelineRunner();
  runner.registerAll(ALL_STEPS);
  await runner.run(ctx, resumeState);

  // ── Final message ───────────────────────────────────────────────
  const testData = ctx.stepOutputs.get('step-11')?.data;
  const testPassed = testData?.testResult?.passed ?? false;
  const testSkipped = testData?.testResult?.skipped ?? true;
  const coverage = testData?.testResult?.coverage;

  const covStr = coverage !== null && coverage !== undefined
    ? `${coverage.toFixed(1)}%` : 'N/A';
  const msg = testPassed
    ? `🎉 DONE! Tests PASSED | Coverage: ${covStr}`
    : testSkipped
      ? `✅ Workflow complete (tests skipped — configure testCommand)`
      : `❌ Tests failed — check Evidence for details`;

  const action = await vscode.window.showInformationMessage(msg, 'Open Session Folder');
  if (action === 'Open Session Folder') {
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(sessionDir));
  }
}
