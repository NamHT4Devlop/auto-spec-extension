"use strict";
/**
 * Auto Spec Kit — VS Code Extension
 * Entry point: activate() registers all commands and wires dependencies.
 * Business logic lives in src/workflow/*.ts
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const logger_1 = require("./logger");
const model_selector_1 = require("./utils/model-selector");
const run_task_1 = require("./workflow/run-task");
const generate_kb_1 = require("./workflow/generate-kb");
const review_file_1 = require("./workflow/review-file");
const update_kb_1 = require("./workflow/update-kb");
const ask_kb_1 = require("./workflow/ask-kb");
const generate_user_stories_1 = require("./workflow/generate-user-stories");
function activate(context) {
    const ch = (0, logger_1.initChannel)('Auto Spec Kit');
    // ── Helper: get workspace root ──────────────────────────────────
    const getRoot = () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage('Auto Spec Kit: Please open a workspace folder first!');
        }
        return root;
    };
    // ── Helper: run with progress notification ───────────────────────
    const withProgress = (title, task) => {
        const cts = new vscode.CancellationTokenSource();
        context.subscriptions.push(cts);
        return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (progress, pToken) => {
            pToken.onCancellationRequested(() => {
                cts.cancel();
                (0, logger_1.log)('\n⚠  Cancelled by user');
            });
            await task(progress, cts.token);
        }));
    };
    // ── Command: Select Model ────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('autoSpecKit.selectModel', async () => {
        ch.show(true);
        await (0, model_selector_1.runSelectModel)();
    }));
    // ── Command: Run Task ───────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('autoSpecKit.run', async () => {
        const root = getRoot();
        if (!root) {
            return;
        }
        const model = await (0, model_selector_1.resolveModel)();
        if (!model) {
            return;
        }
        const req = await vscode.window.showInputBox({
            title: '🚀 Auto Spec Kit — Enter Requirement',
            prompt: 'Describe the feature / task to implement',
            placeHolder: 'e.g. Add reset password feature using email OTP, expires after 10 minutes',
            ignoreFocusOut: true,
        });
        if (!req?.trim()) {
            return;
        }
        ch.show(true);
        (0, logger_1.log)(`\n╔═══════════════════════════════════════════════════════════════╗`);
        (0, logger_1.log)(`║         🚀  AUTO SPEC KIT — DEVELOPMENT WORKFLOW              ║`);
        (0, logger_1.log)(`╚═══════════════════════════════════════════════════════════════╝`);
        (0, logger_1.log)(`\nRequirement: ${req}\nWorkspace  : ${root}\nModel      : ${model.name}  [${model.id}]\n`);
        await withProgress('🚀 Auto Spec Kit', async (progress, token) => {
            try {
                await (0, run_task_1.runWorkflow)(req.trim(), root, model, token, progress, context.extensionPath);
            }
            catch (err) {
                if (!token.isCancellationRequested) {
                    (0, logger_1.log)(`\n❌ ERROR: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage(`Auto Spec Kit: ${err?.message ?? err}`);
                }
            }
        });
    }));
    // ── Command: Generate Knowledge Base ───────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('autoSpecKit.generateKB', async () => {
        const root = getRoot();
        if (!root) {
            return;
        }
        const model = await (0, model_selector_1.resolveModel)();
        if (!model) {
            return;
        }
        ch.show(true);
        await withProgress('📚 Generating Knowledge Base', async (progress, token) => {
            try {
                await (0, generate_kb_1.generateKnowledgeBase)(root, model, token, progress, context.extensionPath);
            }
            catch (err) {
                if (!token.isCancellationRequested) {
                    (0, logger_1.log)(`\n❌ ERROR: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage(`Auto Spec Kit KB: ${err?.message ?? err}`);
                }
            }
        });
    }));
    // ── Command: Review Current File ────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('autoSpecKit.reviewFile', async () => {
        const root = getRoot();
        if (!root) {
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Auto Spec Kit: Please open a file to review.');
            return;
        }
        const model = await (0, model_selector_1.resolveModel)();
        if (!model) {
            return;
        }
        ch.show(true);
        await withProgress('🔍 Reviewing file...', async (_progress, token) => {
            try {
                await (0, review_file_1.reviewCurrentFile)(editor.document, root, model, token, context.extensionPath);
            }
            catch (err) {
                if (!token.isCancellationRequested) {
                    (0, logger_1.log)(`\n❌ ERROR: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage(`Auto Spec Kit Review: ${err?.message ?? err}`);
                }
            }
        });
    }));
    // ── Command: Update Knowledge Base (standalone) ─────────────────
    context.subscriptions.push(vscode.commands.registerCommand('autoSpecKit.updateKB', async () => {
        const root = getRoot();
        if (!root) {
            return;
        }
        const model = await (0, model_selector_1.resolveModel)();
        if (!model) {
            return;
        }
        ch.show(true);
        await withProgress('📚 Updating Knowledge Base...', async (progress, token) => {
            try {
                await (0, update_kb_1.updateKBStandalone)(root, model, token, progress);
            }
            catch (err) {
                if (!token.isCancellationRequested) {
                    (0, logger_1.log)(`\n❌ ERROR: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage(`Auto Spec Kit Update KB: ${err?.message ?? err}`);
                }
            }
        });
    }));
    // ── Command: Ask About Codebase ──────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('autoSpecKit.ask', async () => {
        const root = getRoot();
        if (!root) {
            return;
        }
        const model = await (0, model_selector_1.resolveModel)();
        if (!model) {
            return;
        }
        const question = await vscode.window.showInputBox({
            title: '💬 Ask About Codebase',
            prompt: 'Question about the codebase (Copilot answers based on the Knowledge Base)',
            placeHolder: 'e.g. Which module handles payment? Which API endpoints require auth?',
            ignoreFocusOut: true,
        });
        if (!question?.trim()) {
            return;
        }
        ch.show(true);
        const cts = new vscode.CancellationTokenSource();
        context.subscriptions.push(cts);
        try {
            await (0, ask_kb_1.askAboutCodebase)(question.trim(), root, model, cts.token);
        }
        catch (err) {
            (0, logger_1.log)(`\n❌ ERROR: ${err?.message ?? err}`);
            vscode.window.showErrorMessage(`Auto Spec Kit Ask: ${err?.message ?? err}`);
        }
    }));
    // ── Command: Generate User Stories (PO/BA workflow) ─────────────
    context.subscriptions.push(vscode.commands.registerCommand('autoSpecKit.generateUserStories', async () => {
        const root = getRoot();
        if (!root) {
            return;
        }
        const model = await (0, model_selector_1.resolveModel)();
        if (!model) {
            return;
        }
        ch.show(true);
        (0, logger_1.log)(`\n╔═══════════════════════════════════════════════════════════════╗`);
        (0, logger_1.log)(`║         📋  AUTO SPEC KIT — PO/BA: USER STORIES               ║`);
        (0, logger_1.log)(`╚═══════════════════════════════════════════════════════════════╝`);
        (0, logger_1.log)(`\nWorkspace: ${root}\nModel    : ${model.name}  [${model.id}]\n`);
        await withProgress('📋 Generating User Stories...', async (progress, token) => {
            try {
                await (0, generate_user_stories_1.generateUserStories)(root, model, token, progress);
            }
            catch (err) {
                if (!token.isCancellationRequested) {
                    (0, logger_1.log)(`\n❌ ERROR: ${err?.message ?? err}`);
                    vscode.window.showErrorMessage(`Auto Spec Kit User Stories: ${err?.message ?? err}`);
                }
            }
        });
    }));
    context.subscriptions.push(ch);
}
function deactivate() {
    // channel disposed via subscriptions
}
