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
 *   @autospec (free text → defaults to /ask)
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

const PARTICIPANT_ID = 'auto-spec-kit.autospec';

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
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    stream.markdown('⚠️ **Please open a workspace folder first.**\n\nAuto Spec Kit needs a project folder to work with.');
    return { metadata: { command: request.command ?? 'none' } };
  }

  const command = request.command ?? '';
  const userPrompt = request.prompt.trim();

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

      default:
        // No slash command → treat as /ask if there's a prompt, otherwise show help
        if (userPrompt) {
          return await handleAsk(root, userPrompt, stream, chatToken);
        }
        return showHelp(stream);
    }
  } catch (err: any) {
    if (!chatToken.isCancellationRequested) {
      stream.markdown(`\n\n❌ **Error**: ${err?.message ?? err}`);
      log(`❌ Chat error: ${err?.message ?? err}`);
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

  stream.progress('Building feature — running 13-step pipeline...');
  stream.markdown(`🚀 **Auto Spec Kit — Build Feature**\n\n**Requirement:** ${requirement}\n\n**Model:** ${model.name}\n\n---\n\n`);

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) {
        stream.progress(value.message);
      }
    },
  };

  await runWorkflow(requirement, root, model, token, progress, extContext.extensionPath);

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

  stream.progress('Scanning project...');
  stream.markdown('📚 **Scanning Project**\n\nAnalyzing your codebase with multi-agent batch parallelism (5 batches × 3 agents)...\n\n');

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

function showHelp(stream: vscode.ChatResponseStream): vscode.ChatResult {
  stream.markdown(`# 🚀 Auto Spec Kit — Commands

| Command | Description |
|---------|-------------|
| \`@autospec /build <requirement>\` | Build a feature — full 13-step pipeline |
| \`@autospec /scan\` | Scan the project — generate Knowledge Base |
| \`@autospec /rescan\` | Rescan latest changes — update Knowledge Base |
| \`@autospec /review\` | Review current file — security, architecture, performance |
| \`@autospec /ask <question>\` | Ask about codebase — Q&A powered by KB |
| \`@autospec /plan <epic>\` | Plan user stories — Epic → Stories → Sprint Plan |
| \`@autospec /map\` | Map the codebase — interactive dependency graph |

**Quick start:** Type \`@autospec /scan\` first to scan your project, then use other commands.

**Free text:** \`@autospec How does auth work?\` defaults to \`/ask\`.
`);
  return { metadata: { command: 'help' } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

export function registerChatParticipant(context: vscode.ExtensionContext): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    (request, chatContext, stream, token) =>
      handleChatRequest(request, chatContext, stream, token, context),
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

  log('🤖 Chat Participant @autospec registered');
  context.subscriptions.push(participant);
}
