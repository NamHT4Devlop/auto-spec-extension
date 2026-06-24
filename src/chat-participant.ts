/**
 * chat-participant.ts — Copilot Chat Integration
 *
 * Registers @protector_spec as a Chat Participant in VS Code Copilot Chat.
 * Users can invoke:
 *   @protector_spec /build Add reset password feature
 *   @protector_spec /scan
 *   @protector_spec /rescan
 *   @protector_spec /review
 *   @protector_spec /ask Which module handles payment?
 *   @protector_spec /plan Epic: User onboarding redesign
 *   @protector_spec /map
 *   @protector_spec /help
 *   @protector_spec (free text → defaults to /ask)
 *
 * Integrated systems:
 *   - SessionMemory     — persistent context across long chat sessions
 *   - RequirementClarifier — AI-driven requirement enrichment for vague inputs
 *   - ProjectProfileDetector — auto-detect project stack & conventions
 *   - LearningStore     — agent gets smarter over time from past sessions
 *   - WorkspaceResolver — multi-root workspace, monorepo, .autospec.yml support
 */

import * as vscode from 'vscode';
import { log } from './logger';
import { resolveModel } from './utils/model-selector';
import { runWorkflow } from './workflow/run-task';
import { generateKnowledgeBase } from './workflow/generate-kb';
import { reviewCurrentFile } from './workflow/review-file';
import { updateKBStandalone } from './workflow/update-kb';
import { askAboutCodebase } from './workflow/ask-kb';
import { generateUserStories } from './workflow/generate-user-stories';
import { visualizeKnowledgeBase } from './workflow/visualize-kb';
import { writeDocument } from './workflow/write-document';
import { SessionMemory } from './utils/session-memory';
import { RequirementClarifier } from './utils/requirement-clarifier';
import { ProjectProfileDetector } from './utils/project-profile';
import { LearningStore } from './utils/learning-store';
import { WorkspaceResolver } from './utils/workspace-resolver';
import { GitSyncGuard } from './utils/git-sync-guard';

const PARTICIPANT_ID = 'auto-spec-kit.autospec';

// ── Shared instances (initialized once per extension activation) ──────────────
let sessionMemory: SessionMemory;
let workspaceResolver: WorkspaceResolver;
let requirementClarifier: RequirementClarifier;

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleChatRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  chatToken: vscode.CancellationToken,
  extensionContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  // ── Resolve workspace root (supports multi-root + monorepo) ──
  const command = request.command ?? '';
  const userPrompt = request.prompt.trim();

  let root: string | null;
  if (command === 'help' || (!command && !userPrompt)) {
    // Quick resolve for help — no picker
    root = workspaceResolver.resolveQuick();
  } else {
    // Full resolve — may show picker for multi-root/monorepo
    const resolved = await workspaceResolver.resolve();
    root = resolved?.root ?? null;

    // Apply .autospec.yml overrides if present
    if (resolved?.configOverrides) {
      workspaceResolver.applyConfigOverrides(resolved.configOverrides);
    }
  }

  if (!root) {
    stream.markdown('⚠️ **Please open a workspace folder first.**\n\nAuto Spec Kit needs a project folder to work with.');
    return { metadata: { command: request.command ?? 'none' } };
  }

  log(`\n🤖 Chat: @protector_spec /${command} ${userPrompt}`);

  // ── Auto-sync: fetch + pull latest code before every command ──
  // Gated on workspace trust: auto-sync runs git against the project remote, which
  // we do not perform in untrusted workspaces.
  const autoSyncEnabled = vscode.workspace.getConfiguration('autoSpecKit').get<boolean>('autoSync', true);
  if (autoSyncEnabled && command !== 'help' && vscode.workspace.isTrusted) {
    await performAutoSync(root, stream, chatToken, extensionContext);
  } else if (autoSyncEnabled && command !== 'help' && !vscode.workspace.isTrusted) {
    log('🔒 Workspace is not trusted — skipping git auto-sync.');
  }

  try {
    switch (command) {
      case 'build':
        return await handleBuild(root, userPrompt, stream, chatToken, extensionContext);

      case 'scan':
        return await handleScan(root, stream, chatToken, extensionContext);

      case 'rescan':
        return await handleRescan(root, stream, chatToken);

      case 'review':
        return await handleReview(root, stream, chatToken, extensionContext);

      case 'ask':
        return await handleAsk(root, userPrompt, stream, chatToken);

      case 'plan':
        return await handlePlan(root, userPrompt, stream, chatToken);

      case 'map':
        return await handleMap(root, stream, extensionContext);

      case 'document':
        return await handleDocument(root, userPrompt, stream, chatToken);

      case 'help':
        return showHelp(stream, root);

      default:
        // No slash command → treat as /ask if there's a prompt, otherwise show help
        if (userPrompt) {
          return await handleAsk(root, userPrompt, stream, chatToken);
        }
        return showHelp(stream, root);
    }
  } catch (err: any) {
    if (!chatToken.isCancellationRequested) {
      stream.markdown(`\n\n❌ **Error**: ${err?.message ?? err}`);
      log(`❌ Chat error: ${err?.message ?? err}`);
      sessionMemory.addError(`${command}: ${err?.message ?? err}`);
    }
    return { metadata: { command, error: err?.message } };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function handleBuild(
  root: string,
  requirement: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  if (!requirement) {
    stream.markdown('Please describe the feature to build.\n\n**Example:**\n```\n@protector_spec /build Add reset password feature using email OTP, expires after 10 minutes\n```');
    return { metadata: { command: 'build' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available. Please ensure GitHub Copilot is active.');
    return { metadata: { command: 'build' } };
  }

  // ── Clarify vague requirements (halt instead of building the wrong thing) ──
  const clarity = await requirementClarifier.clarifyIfNeeded(
    requirement, root, model, token, stream,
  );
  if (!clarity.proceed) {
    // Questions were streamed to the user; do not run the expensive pipeline.
    return { metadata: { command: 'build', halted: 'needs-clarification' } };
  }
  const enrichedRequirement = clarity.requirement;

  // ── Auto-detect project profile ──
  const profileDetector = new ProjectProfileDetector(root);
  const profile = profileDetector.detect();
  const profileContext = ProjectProfileDetector.toPromptContext(profile);

  // ── Load learnings ──
  const learningStore = new LearningStore(root);
  const learningsContext = learningStore.toPromptContext();

  // ── Start session memory ──
  sessionMemory.startSession('build', enrichedRequirement);
  if (profileContext) { sessionMemory.addDecision(`Project: ${profileContext}`); }

  stream.progress('Building feature — running 13-step pipeline...');
  stream.markdown(`🚀 **Auto Spec Kit — Build Feature**\n\n**Requirement:** ${enrichedRequirement}\n\n**Model:** ${model.name}\n\n---\n\n`);

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) {
        stream.progress(value.message);
        sessionMemory.addMilestone(value.message);
      }
    },
  };

  // ── Get effective config (respects .autospec.yml overrides) ──
  const effectiveConfig = workspaceResolver.getEffectiveConfig(root);

  await runWorkflow(enrichedRequirement, root, model, token, progress, extContext.extensionPath, {
    profileContext,
    learningsContext,
    sessionContext: sessionMemory.getContextForPrompt(3000),
    effectiveConfig,
  });

  sessionMemory.addMilestone('Build pipeline completed');
  sessionMemory.endSession();

  stream.markdown('\n\n✅ **Build completed!** Check the Output panel (`Auto Spec Kit`) for full details.\n\nGenerated files are in your `spec-kit-sessions/` folder.');

  return { metadata: { command: 'build' } };
}

async function handleScan(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'scan' } };
  }

  // Auto-detect project profile (refreshes during scan)
  const profileDetector = new ProjectProfileDetector(root);
  const profile = profileDetector.detect(true); // force refresh on scan
  log(`📋 Scan: detected ${profile.language} / ${profile.framework}`);

  // Get scan options from .autospec.yml (if scan.excludeDocs is set, pass through)
  const effectiveConfig = workspaceResolver.getEffectiveConfig(root);
  const scanOptions = {
    excludeDocs: effectiveConfig.scan.excludeDocs,
    excludeExtra: effectiveConfig.scan.exclude,
  };

  stream.progress('Scanning project...');
  stream.markdown(`📚 **Scanning Project** — ${profile.language} / ${profile.framework}\n\nAnalyzing your codebase with multi-agent batch parallelism (5 batches × 3 agents)...\n\n`);

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) { stream.progress(value.message); }
    },
  };

  await generateKnowledgeBase(root, model, token, progress, extContext.extensionPath, scanOptions);

  stream.markdown('\n\n✅ **Scan complete!** Knowledge Base generated in `knowledge-base/` — 15 markdown files covering architecture, APIs, business logic, and more.');

  return { metadata: { command: 'scan' } };
}

async function handleReview(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    stream.markdown('⚠️ **No file open.** Please open a file in the editor first, then run `@protector_spec /review`.');
    return { metadata: { command: 'review' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'review' } };
  }

  const fileName = editor.document.fileName.replace(root, '').replace(/^\//, '');
  stream.progress(`Reviewing ${fileName}...`);
  stream.markdown(`🔍 **Reviewing:** \`${fileName}\`\n\n`);

  await reviewCurrentFile(editor.document, root, model, token, extContext.extensionPath);

  stream.markdown('\n\n✅ **Review complete!** Check the Output panel for detailed findings.');

  return { metadata: { command: 'review' } };
}

async function handleAsk(
  root: string,
  question: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!question) {
    stream.markdown('Ask a question about your codebase.\n\n**Examples:**\n```\n@protector_spec /ask Which module handles payment?\n@protector_spec /ask What API endpoints require authentication?\n@protector_spec /ask How does the order flow work?\n```');
    return { metadata: { command: 'ask' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'ask' } };
  }

  stream.progress('Searching Knowledge Base...');
  stream.markdown(`💬 **Question:** ${question}\n\n---\n\n`);

  await askAboutCodebase(question, root, model, token);

  stream.markdown('\n\n✅ Check the Output panel for the full answer (based on your Knowledge Base).');

  return { metadata: { command: 'ask' } };
}

async function handlePlan(
  root: string,
  epicDescription: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!epicDescription) {
    stream.markdown('Please provide an Epic description.\n\n**Example:**\n```\n@protector_spec /plan User Onboarding Redesign: Simplify the registration process, add social login (Google, GitHub), implement email verification with OTP, and create a guided setup wizard for new users.\n```');
    return { metadata: { command: 'plan' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'plan' } };
  }

  stream.progress('Planning user stories — investigating KB...');
  stream.markdown(`📋 **Plan User Stories**\n\n**Epic:** ${epicDescription}\n\n7-step pipeline: KB Investigation → Feature Discovery → Impact Analysis → Confirmation → Story Gen → Sprint Planning → Report\n\n`);

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) { stream.progress(value.message); }
    },
  };

  await generateUserStories(root, model, token, progress);

  stream.markdown('\n\n✅ **User Stories planned!** Check `spec-kit-sessions/` for:\n- `features.md` — discovered features\n- `confirmation-checklist.md` — items to confirm\n- `user-stories.md` — full user stories\n- `sprint-plan.md` — sprint breakdown');

  return { metadata: { command: 'plan' } };
}

async function handleMap(
  root: string,
  stream: vscode.ChatResponseStream,
  extContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  stream.progress('Mapping codebase dependencies...');
  stream.markdown('🔭 **Map Codebase**\n\nScanning codebase (multi-language) and optionally enriching with AI...\n\n');

  await visualizeKnowledgeBase(root, extContext);

  stream.markdown('\n\n✅ **Codebase map opened!** Check the webview panel and saved HTML file.');

  return { metadata: { command: 'map' } };
}

async function handleDocument(
  root: string,
  topic: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!topic) {
    stream.markdown('Please say what to document.\n\n**Example:**\n```\n@protector_spec /document Order checkout flow\n@protector_spec /document User entity (field-level mapping)\n```');
    return { metadata: { command: 'document' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'document' } };
  }

  stream.progress('Investigating & writing document (business ↔ code)...');
  const result = await writeDocument(topic, root, model, token);

  // Show the document in chat and point to the exported HTML.
  stream.markdown(result.markdown);
  stream.markdown(`\n\n---\n📄 **Exported HTML:** \`${result.htmlFile}\` (also opened in a panel — use "Open HTML in Browser" to view/print).`);

  return { metadata: { command: 'document' } };
}

async function handleRescan(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'rescan' } };
  }

  stream.progress('Rescanning latest changes...');
  stream.markdown('📚 **Rescanning** — updating Knowledge Base with latest changes...\n\n');

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) { stream.progress(value.message); }
    },
  };

  await updateKBStandalone(root, model, token, progress);

  stream.markdown('\n\n✅ **Rescan complete!** Knowledge Base updated.');

  return { metadata: { command: 'rescan' } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELP
// ═══════════════════════════════════════════════════════════════════════════════

function showHelp(stream: vscode.ChatResponseStream, root?: string): vscode.ChatResult {
  // ── Detect KB status ──
  let kbStatus = '❌ Not generated yet';
  if (root) {
    const cfg = vscode.workspace.getConfiguration('autoSpecKit');
    const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
    const kbDir = require('path').join(root, kbRelPath);
    const fs = require('fs');
    if (fs.existsSync(kbDir)) {
      try {
        const files = fs.readdirSync(kbDir).filter((f: string) => f.endsWith('.md'));
        const stat = fs.statSync(kbDir);
        const ago = Math.round((Date.now() - stat.mtimeMs) / 60000);
        const agoText = ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago / 60)}h ago` : `${Math.round(ago / 1440)}d ago`;
        kbStatus = `✅ ${files.length} files (updated ${agoText})`;
      } catch { kbStatus = '⚠️ Error reading KB'; }
    }
  }

  // ── Detect model ──
  const modelCfg = vscode.workspace.getConfiguration('autoSpecKit').get<string>('model', '');
  const modelText = modelCfg ? `\`${modelCfg}\`` : 'Auto (best available)';

  // ── Detect sessions ──
  let sessionText = 'No sessions yet';
  if (root) {
    const fs = require('fs');
    const path = require('path');
    const sessionsDir = vscode.workspace.getConfiguration('autoSpecKit').get<string>('sessionsDir', 'spec-kit-sessions');
    const sessionsPath = path.join(root, sessionsDir);
    if (fs.existsSync(sessionsPath)) {
      try {
        const dirs = fs.readdirSync(sessionsPath, { withFileTypes: true })
          .filter((e: any) => e.isDirectory());
        sessionText = dirs.length > 0 ? `${dirs.length} session(s)` : 'No sessions yet';
      } catch { /* ignore */ }
    }
  }

  // ── Detect project profile ──
  let profileText = 'Not detected';
  if (root) {
    const fs = require('fs');
    const path = require('path');
    const profilePath = path.join(root, '.autospec', 'profile.json');
    if (fs.existsSync(profilePath)) {
      try {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        profileText = `✅ ${profile.language ?? 'unknown'} / ${profile.framework ?? 'unknown'}`;
      } catch { profileText = '⚠️ Error'; }
    }
  }

  // ── Detect learnings ──
  let learningsText = 'No learnings yet';
  if (root) {
    const fs = require('fs');
    const path = require('path');
    const learningsPath = path.join(root, '.autospec', 'learnings.json');
    if (fs.existsSync(learningsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(learningsPath, 'utf-8'));
        const count = data.learnings?.length ?? 0;
        learningsText = count > 0 ? `🧠 ${count} learning(s)` : 'No learnings yet';
      } catch { /* ignore */ }
    }
  }

  // ── Detect monorepo ──
  let workspaceText = 'Single project';
  if (root) {
    const mono = workspaceResolver.detectMonorepo(root);
    if (mono) {
      workspaceText = `📦 ${mono.tool} monorepo (${mono.packages.length} packages)`;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 1) {
      workspaceText = `📂 Multi-root (${folders.length} folders)`;
    }
  }

  // ── Detect .autospec.yml ──
  let configText = 'Default';
  if (root) {
    const fs = require('fs');
    const path = require('path');
    if (fs.existsSync(path.join(root, '.autospec.yml'))) { configText = '✅ .autospec.yml'; }
    else if (fs.existsSync(path.join(root, '.autospec.json'))) { configText = '✅ .autospec.json'; }
  }

  stream.markdown(`# 🚀 Auto Spec Kit — Help

## Status

| Item | Status |
|------|--------|
| **Knowledge Base** | ${kbStatus} |
| **Model** | ${modelText} |
| **Sessions** | ${sessionText} |
| **Project Profile** | ${profileText} |
| **Learnings** | ${learningsText} |
| **Workspace** | ${workspaceText} |
| **Config** | ${configText} |

## Commands

| Command | Description |
|---------|-------------|
| \`@protector_spec /build <requirement>\` | Build a feature — full 13-step pipeline |
| \`@protector_spec /scan\` | Scan the project — generate Knowledge Base |
| \`@protector_spec /rescan\` | Rescan latest changes — update Knowledge Base |
| \`@protector_spec /review\` | Review current file — security, architecture, performance |
| \`@protector_spec /ask <question>\` | Ask about codebase — Q&A powered by KB |
| \`@protector_spec /plan <epic>\` | Plan user stories — Epic → Stories → Sprint Plan |
| \`@protector_spec /map\` | Map the codebase — interactive dependency graph |
| \`@protector_spec /document <topic>\` | Write a technical doc — business ↔ code field mapping, exported as HTML |
| \`@protector_spec /help\` | Show this help with status info |

## Quick Start

1. \`@protector_spec /scan\` — scan your project first (generates Knowledge Base)
2. \`@protector_spec /build Add reset password feature\` — run the 13-step pipeline
3. \`@protector_spec /review\` — review any open file with 4 AI agents

**Free text:** \`@protector_spec How does auth work?\` defaults to \`/ask\`.

**Keyboard shortcuts:** \`Cmd+Shift+K\` (Build) · \`Cmd+Shift+B\` (Scan) · \`Cmd+Shift+U\` (Plan)
`);
  return { metadata: { command: 'help' } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-SYNC
// ═══════════════════════════════════════════════════════════════════════════════

async function performAutoSync(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extContext: vscode.ExtensionContext,
): Promise<void> {
  if (!GitSyncGuard.isGitRepo(root)) { return; }

  stream.progress('Syncing latest code...');
  const syncResult = await GitSyncGuard.sync(root);

  if (syncResult.error) {
    log(`⚠️ AutoSync: ${syncResult.error}`);
    // Non-fatal — continue with current code
  }

  if (syncResult.newCommits > 0) {
    stream.markdown(`🔄 **Synced:** ${syncResult.newCommits} new commit(s) pulled\n\n`);
  }

  // ── Auto-update KB if source files changed ──
  const autoKBUpdate = vscode.workspace.getConfiguration('autoSpecKit').get<boolean>('autoSyncKBUpdate', true);
  if (!autoKBUpdate) { return; }

  const effectiveConfig = workspaceResolver.getEffectiveConfig(root);
  const kbRelPath = effectiveConfig.knowledgeBasePath;

  // KB needs update if: new source commits pulled, OR KB is stale vs local files
  const needsUpdate = syncResult.kbNeedsUpdate || GitSyncGuard.isKBStale(root, kbRelPath);

  if (!needsUpdate) { return; }

  // Check if KB even exists — if not, skip auto-update (user should /scan first)
  const kbDir = require('path').join(root, kbRelPath);
  if (!require('fs').existsSync(kbDir)) {
    log('📚 AutoSync: KB not found — skipping auto-update (run /scan first)');
    return;
  }

  if (token.isCancellationRequested) { return; }

  stream.progress('Updating Knowledge Base with latest changes...');
  stream.markdown('📚 **Auto-updating KB** — source files changed since last scan...\n\n');

  try {
    const model = await resolveModel();
    if (model) {
      const progress: vscode.Progress<{ message?: string; increment?: number }> = {
        report: (value) => { if (value.message) { stream.progress(value.message); } },
      };
      await updateKBStandalone(root, model, token, progress);
      stream.markdown('✅ **KB updated** — proceeding with command\n\n---\n\n');
      log('✅ AutoSync: KB updated successfully');
    }
  } catch (err: any) {
    log(`⚠️ AutoSync KB update failed: ${err.message}`);
    // Non-fatal — continue with potentially stale KB
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  // ── Initialize shared instances ──
  sessionMemory = new SessionMemory(context);
  workspaceResolver = new WorkspaceResolver();
  requirementClarifier = new RequirementClarifier();

  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    (request, chatContext, stream, token) =>
      handleChatRequest(request, chatContext, stream, token, context),
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

  log('🤖 Chat Participant @protector_spec registered (with SessionMemory, Clarifier, Resolver)');
  context.subscriptions.push(participant);
}
