/**
 * Auto Spec Kit — VS Code Extension
 * Entry point: activate() registers all commands and wires dependencies.
 * Business logic lives in src/workflow/*.ts
 */

import * as vscode from 'vscode';
import { initChannel, log } from './logger';
import { resolveModel, runSelectModel } from './utils/model-selector';
import { runWorkflow } from './workflow/run-task';
import { generateKnowledgeBase } from './workflow/generate-kb';
import { reviewCurrentFile } from './workflow/review-file';
import { updateKBStandalone } from './workflow/update-kb';
import { askAboutCodebase } from './workflow/ask-kb';
import { generateUserStories } from './workflow/generate-user-stories';
import { visualizeKnowledgeBase } from './workflow/visualize-kb';
import { registerChatParticipant } from './chat-participant';

export function activate(context: vscode.ExtensionContext): void {
  const ch = initChannel('Auto Spec Kit');

  // ── Chat Participant: @autospec ──────────────────────────────────
  registerChatParticipant(context);

  const getRoot = (): string | undefined => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showErrorMessage('Auto Spec Kit: Please open a workspace folder first!');
    }
    return root;
  };

  const withProgress = (
    title: string,
    task: (
      progress: vscode.Progress<{ message?: string; increment?: number }>,
      token: vscode.CancellationToken
    ) => Promise<void>
  ): Promise<void> => {
    const cts = new vscode.CancellationTokenSource();
    context.subscriptions.push(cts);
    return Promise.resolve(vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      async (progress, pToken) => {
        pToken.onCancellationRequested(() => {
          cts.cancel();
          log('\n⚠  Cancelled by user');
        });
        await task(progress, cts.token);
      }
    ));
  };

  // ── Command: Select Model ────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.selectModel', async () => {
      ch.show(true);
      await runSelectModel();
    })
  );

  // ── Command: Run Task ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.run', async () => {
      const root = getRoot(); if (!root) { return; }
      const model = await resolveModel(); if (!model) { return; }
      const req = await vscode.window.showInputBox({
        title: '🚀 Auto Spec Kit — Enter Requirement',
        prompt: 'Describe the feature / task to implement',
        placeHolder: 'e.g. Add reset password feature using email OTP, expires after 10 minutes',
        ignoreFocusOut: true,
      });
      if (!req?.trim()) { return; }
      ch.show(true);
      log(`\n╔═══════════════════════════════════════════════════════════════╗`);
      log(`║         🚀  AUTO SPEC KIT — DEVELOPMENT WORKFLOW              ║`);
      log(`╚═══════════════════════════════════════════════════════════════╝`);
      log(`\nRequirement: ${req}\nWorkspace  : ${root}\nModel      : ${model.name}  [${model.id}]\n`);
      await withProgress('🚀 Auto Spec Kit', async (progress, token) => {
        try {
          await runWorkflow(req.trim(), root, model, token, progress, context.extensionPath);
        } catch (err: any) {
          if (!token.isCancellationRequested) {
            log(`\n❌ ERROR: ${err?.message ?? err}`);
            vscode.window.showErrorMessage(`Auto Spec Kit: ${err?.message ?? err}`);
          }
        }
      });
    })
  );

  // ── Command: Generate Knowledge Base ───────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.generateKB', async () => {
      const root = getRoot(); if (!root) { return; }
      const model = await resolveModel(); if (!model) { return; }
      ch.show(true);
      await withProgress('📚 Generating Knowledge Base', async (progress, token) => {
        try {
          await generateKnowledgeBase(root, model, token, progress, context.extensionPath);
        } catch (err: any) {
          if (!token.isCancellationRequested) {
            log(`\n❌ ERROR: ${err?.message ?? err}`);
            vscode.window.showErrorMessage(`Auto Spec Kit KB: ${err?.message ?? err}`);
          }
        }
      });
    })
  );

  // ── Command: Review Current File ────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.reviewFile', async () => {
      const root = getRoot(); if (!root) { return; }
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Auto Spec Kit: Please open a file to review.');
        return;
      }
      const model = await resolveModel(); if (!model) { return; }
      ch.show(true);
      await withProgress('🔍 Reviewing file...', async (_progress, token) => {
        try {
          await reviewCurrentFile(editor.document, root, model, token, context.extensionPath);
        } catch (err: any) {
          if (!token.isCancellationRequested) {
            log(`\n❌ ERROR: ${err?.message ?? err}`);
            vscode.window.showErrorMessage(`Auto Spec Kit Review: ${err?.message ?? err}`);
          }
        }
      });
    })
  );

  // ── Command: Update Knowledge Base ─────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.updateKB', async () => {
      const root = getRoot(); if (!root) { return; }
      const model = await resolveModel(); if (!model) { return; }
      ch.show(true);
      await withProgress('📚 Updating Knowledge Base...', async (progress, token) => {
        try {
          await updateKBStandalone(root, model, token, progress);
        } catch (err: any) {
          if (!token.isCancellationRequested) {
            log(`\n❌ ERROR: ${err?.message ?? err}`);
            vscode.window.showErrorMessage(`Auto Spec Kit Update KB: ${err?.message ?? err}`);
          }
        }
      });
    })
  );

  // ── Command: Ask About Codebase ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.ask', async () => {
      const root = getRoot(); if (!root) { return; }
      const model = await resolveModel(); if (!model) { return; }
      const question = await vscode.window.showInputBox({
        title: '💬 Ask About Codebase',
        prompt: 'Question about the codebase (Copilot answers based on the Knowledge Base)',
        placeHolder: 'e.g. Which module handles payment? Which API endpoints require auth?',
        ignoreFocusOut: true,
      });
      if (!question?.trim()) { return; }
      ch.show(true);
      const cts = new vscode.CancellationTokenSource();
      context.subscriptions.push(cts);
      try {
        await askAboutCodebase(question.trim(), root, model, cts.token);
      } catch (err: any) {
        log(`\n❌ ERROR: ${err?.message ?? err}`);
        vscode.window.showErrorMessage(`Auto Spec Kit Ask: ${err?.message ?? err}`);
      }
    })
  );

  // ── Command: Generate User Stories ─────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.generateUserStories', async () => {
      const root = getRoot(); if (!root) { return; }
      const model = await resolveModel(); if (!model) { return; }
      ch.show(true);
      log(`\n╔═══════════════════════════════════════════════════════════════╗`);
      log(`║         📋  AUTO SPEC KIT — PO/BA: USER STORIES               ║`);
      log(`╚═══════════════════════════════════════════════════════════════╝`);
      log(`\nWorkspace: ${root}\nModel    : ${model.name}  [${model.id}]\n`);
      await withProgress('📋 Generating User Stories...', async (progress, token) => {
        try {
          await generateUserStories(root, model, token, progress);
        } catch (err: any) {
          if (!token.isCancellationRequested) {
            log(`\n❌ ERROR: ${err?.message ?? err}`);
            vscode.window.showErrorMessage(`Auto Spec Kit User Stories: ${err?.message ?? err}`);
          }
        }
      });
    })
  );

  // ── Command: Visualize Knowledge Base ───────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('autoSpecKit.visualize', async () => {
      const root = getRoot(); if (!root) { return; }
      ch.show(true);
      log(`\n╔═══════════════════════════════════════════════════════════════╗`);
      log(`║         🔭  AUTO SPEC KIT — KNOWLEDGE GRAPH                   ║`);
      log(`╚═══════════════════════════════════════════════════════════════╝`);
      log(`\nWorkspace: ${root}\n`);
      try {
        await visualizeKnowledgeBase(root, context);
      } catch (err: any) {
        log(`\n❌ ERROR: ${err?.message ?? err}`);
        vscode.window.showErrorMessage(`Auto Spec Kit Visualize: ${err?.message ?? err}`);
      }
    })
  );

  context.subscriptions.push(ch);
}

export function deactivate(): void {
  // channel disposed via subscriptions
}
