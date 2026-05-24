"use strict";
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
exports.askAboutCodebase = askAboutCodebase;
const vscode = __importStar(require("vscode"));
const logger_1 = require("../logger");
const copilot_1 = require("../utils/copilot");
const file_utils_1 = require("../utils/file-utils");
async function askAboutCodebase(question, workspaceRoot, model, token) {
    const cfg = vscode.workspace.getConfiguration('autoSpecKit');
    const kbRelPath = cfg.get('knowledgeBasePath', 'knowledge-base');
    // 1. Load KB
    const kb = (0, file_utils_1.loadKnowledgeBase)(workspaceRoot, kbRelPath);
    // 2. Build SYSTEM
    const SYSTEM = `You are an expert on this codebase. Answer questions based ONLY on the knowledge base below.\n\n=== KNOWLEDGE BASE ===\n${kb}`;
    // 3. Log banner
    (0, logger_1.banner)(['💬 ASK ABOUT CODEBASE', `Q: ${question.slice(0, 60)}`]);
    (0, logger_1.log)(`ℹ  Question: ${question}\n`);
    // 4. Call Copilot
    const answer = await (0, copilot_1.callCopilot)(model, SYSTEM, question, token, 'Ask About Codebase');
    // 5. Build result document
    const content = `# 💬 Answer: ${question.slice(0, 80)}
_${new Date().toLocaleString('en-US')}_

---

${answer}
`;
    // 6. Open document
    const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    (0, logger_1.log)(`\n✅ Answer displayed in new document.`);
}
