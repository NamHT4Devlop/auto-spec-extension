/**
 * chat-participant.ts — Copilot Chat Integration
 *
 * Registers @autospec as a Chat Participant in VS Code Copilot Chat.
 * Users can invoke:
 *   @autospec /build Add reset password feature
 *   @autospec /scan
 *   @autospec /rescan
 *   @autospec /review
 *   @autospec /ask Which module handles payment?
 *   @autospec /plan Epic: User onboarding redesign
 *   @autospec /map
 *   @autospec /help
 *   @autospec (free text → defaults to /ask)
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
import { SessionMemory } from './utils/session-memory';
import { RequirementClarifier } from './utils/requirement-clarifier';
import { ProjectProfileDetector } from './utils/project-profile';
import { LearningStore } from './utils/learning-store';
import { WorkspaceResolver } from './utils/workspace-resolver';

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

  log(`\n🤖 Chat: @autospec /${command} ${userPrompt}`);

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
    stream.markdown('Please describe the feature to build.\n\n**Example:**\n```\n@autospec /build Add reset password feature using email OTP, expires after 10 minutes\n```');
    return { metadata: { command: 'build' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available. Please ensure GitHub Copilot is active.');
    return { metadata: { command: 'build' } };
  }

  // ── Clarify vague requirements ──
  const enrichedRequirement = await requirementClarifier.clarifyIfNeeded(
    requirement, root, model, token, stream,
  );

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

  stream.progress('Scanning project...');
  stream.markdown(`📚 **Scanning Project** — ${profile.language} / ${profile.framework}\n\nAnalyzing your codebase with multi-agent batch parallelism (5 batches × 3 agents)...\n\n`);

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) { stream.progress(value.message); }
    },
  };

  await generateKnowledgeBase(root, model, token, progress, extContext.extensionPath);

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
    stream.markdown('⚠️ **No file open.** Please open a file in the editor first, then run `@autospec /review`.');
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
    stream.markdown('Ask a question about your codebase.\n\n**Examples:**\n```\n@autospec /ask Which module handles payment?\n@autospec /ask What API endpoints require authentication?\n@autospec /ask How does the order flow work?\n```');
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
    stream.markdown('Please provide an Epic description.\n\n**Example:**\n```\n@autospec /plan User Onboarding Redesign: Simplify the registration process, add social login (Google, GitHub), implement email verification with OTP, and create a guided setup wizard for new users.\n```');
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
| \`@autospec /build <requirement>\` | Build a feature — full 13-step pipeline |
| \`@autospec /scan\` | Scan the project — generate Knowledge Base |
| \`@autospec /rescan\` | Rescan latest changes — update Knowledge Base |
| \`@autospec /review\` | Review current file — security, architecture, performance |
| \`@autospec /ask <question>\` | Ask about codebase — Q&A powered by KB |
| \`@autospec /plan <epic>\` | Plan user stories — Epic → Stories → Sprint Plan |
| \`@autospec /map\` | Map the codebase — interactive dependency graph |
| \`@autospec /help\` | Show this help with status info |

## Quick Start

1. \`@autospec /scan\` — scan your project first (generates Knowledge Base)
2. \`@autospec /build Add reset password feature\` — run the 13-step pipeline
3. \`@autospec /review\` — review any open file with 4 AI agents

**Free text:** \`@autospec How does auth work?\` defaults to \`/ask\`.

**Keyboard shortcuts:** \`Cmd+Shift+K\` (Build) · \`Cmd+Shift+B\` (Scan) · \`Cmd+Shift+U\` (Plan)
`);
  return { metadata: { command: 'help' } };
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

  log('🤖 Chat Participant @autospec registered (with SessionMemory, Clarifier, Resolver)');
  context.subscriptions.push(participant);
}
