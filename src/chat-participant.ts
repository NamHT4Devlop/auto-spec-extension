/**
 * chat-participant.ts — Copilot Chat Integration
 *
 * Registers @autospec as a Chat Participant in VS Code Copilot Chat.
 * Users can invoke:
 *   @autospec /run Add reset password feature
 *   @autospec /kb
 *   @autospec /review
 *   @autospec /ask Which module handles payment?
 *   @autospec /stories Epic: User onboarding redesign
 *   @autospec /graph
 *   @autospec /update-kb
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
      case 'run':
        return await handleRun(root, userPrompt, stream, chatToken, extensionContext);

      case 'kb':
        return await handleGenerateKB(root, stream, chatToken, extensionContext);

      case 'review':
        return await handleReview(root, stream, chatToken, extensionContext);

      case 'ask':
        return await handleAsk(root, userPrompt, stream, chatToken);

      case 'stories':
        return await handleStories(root, userPrompt, stream, chatToken);

      case 'graph':
        return await handleGraph(root, stream, extensionContext);

      case 'update-kb':
        return await handleUpdateKB(root, stream, chatToken);

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

async function handleRun(
  root: string,
  requirement: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  if (!requirement) {
    stream.markdown('Please describe the feature or task to implement.\n\n**Example:**\n```\n@autospec /run Add reset password feature using email OTP, expires after 10 minutes\n```');
    return { metadata: { command: 'run' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available. Please ensure GitHub Copilot is active.');
    return { metadata: { command: 'run' } };
  }

  stream.progress('Running 13-step pipeline...');
  stream.markdown(`🚀 **Auto Spec Kit — Dev Workflow**\n\n**Requirement:** ${requirement}\n\n**Model:** ${model.name}\n\n---\n\n`);

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) {
        stream.progress(value.message);
      }
    },
  };

  await runWorkflow(requirement, root, model, token, progress, extContext.extensionPath);

  stream.markdown('\n\n✅ **Pipeline completed!** Check the Output panel (`Auto Spec Kit`) for full details.\n\nGenerated files are in your `spec-kit-sessions/` folder.');

  return { metadata: { command: 'run' } };
}

async function handleGenerateKB(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'kb' } };
  }

  stream.progress('Scanning codebase and generating Knowledge Base...');
  stream.markdown('📚 **Generating Knowledge Base**\n\nAnalyzing your codebase with multi-agent batch parallelism (5 batches × 3 agents)...\n\n');

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) { stream.progress(value.message); }
    },
  };

  await generateKnowledgeBase(root, model, token, progress, extContext.extensionPath);

  stream.markdown('\n\n✅ **Knowledge Base generated!** Check the `knowledge-base/` folder for 15 markdown files covering architecture, APIs, business logic, and more.');

  return { metadata: { command: 'kb' } };
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
    stream.markdown('Please ask a question about your codebase.\n\n**Examples:**\n```\n@autospec /ask Which module handles payment?\n@autospec /ask What API endpoints require authentication?\n@autospec /ask How does the order flow work?\n```');
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

async function handleStories(
  root: string,
  epicDescription: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!epicDescription) {
    stream.markdown('Please provide an Epic description.\n\n**Example:**\n```\n@autospec /stories User Onboarding Redesign: Simplify the registration process, add social login (Google, GitHub), implement email verification with OTP, and create a guided setup wizard for new users.\n```');
    return { metadata: { command: 'stories' } };
  }

  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'stories' } };
  }

  stream.progress('Investigating KB & auto-discovering features...');
  stream.markdown(`📋 **PO/BA: User Story Generation**\n\n**Epic:** ${epicDescription}\n\n7-step pipeline: KB Investigation → Feature Discovery → Impact Analysis → Confirmation → Story Gen → Sprint Planning → Report\n\n`);

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) { stream.progress(value.message); }
    },
  };

  await generateUserStories(root, model, token, progress);

  stream.markdown('\n\n✅ **User Stories generated!** Check `spec-kit-sessions/` for:\n- `features.md` — discovered features\n- `confirmation-checklist.md` — items to confirm\n- `user-stories.md` — full user stories\n- `sprint-plan.md` — sprint breakdown');

  return { metadata: { command: 'stories' } };
}

async function handleGraph(
  root: string,
  stream: vscode.ChatResponseStream,
  extContext: vscode.ExtensionContext,
): Promise<vscode.ChatResult> {
  stream.progress('Building Knowledge Graph...');
  stream.markdown('🔭 **Knowledge Graph**\n\nScanning codebase (multi-language) and optionally enriching with AI...\n\n');

  await visualizeKnowledgeBase(root, extContext);

  stream.markdown('\n\n✅ **Graph opened!** Check the webview panel and saved HTML file.');

  return { metadata: { command: 'graph' } };
}

async function handleUpdateKB(
  root: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  const model = await resolveModel();
  if (!model) {
    stream.markdown('⚠️ No Copilot model available.');
    return { metadata: { command: 'update-kb' } };
  }

  stream.progress('Updating Knowledge Base...');
  stream.markdown('📚 **Updating Knowledge Base** with latest codebase changes...\n\n');

  const progress: vscode.Progress<{ message?: string; increment?: number }> = {
    report: (value) => {
      if (value.message) { stream.progress(value.message); }
    },
  };

  await updateKBStandalone(root, model, token, progress);

  stream.markdown('\n\n✅ **Knowledge Base updated!**');

  return { metadata: { command: 'update-kb' } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELP
// ═══════════════════════════════════════════════════════════════════════════════

function showHelp(stream: vscode.ChatResponseStream): vscode.ChatResult {
  stream.markdown(`# 🚀 Auto Spec Kit — Commands

| Command | Description |
|---------|-------------|
| \`@autospec /run <requirement>\` | Run full 13-step dev pipeline |
| \`@autospec /kb\` | Generate Knowledge Base |
| \`@autospec /update-kb\` | Update KB with latest changes |
| \`@autospec /review\` | Review current open file |
| \`@autospec /ask <question>\` | Ask about codebase (uses KB) |
| \`@autospec /stories <epic>\` | Generate User Stories (PO/BA) |
| \`@autospec /graph\` | Visualize Knowledge Graph |

**Quick start:** Type \`@autospec /kb\` first to generate your Knowledge Base, then use other commands.

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
