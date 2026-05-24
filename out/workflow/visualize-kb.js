"use strict";
/**
 * visualize-kb.ts
 * Command: autoSpecKit.visualize
 * Builds a knowledge graph from KB + src, opens a D3.js webview panel,
 * and saves a self-contained HTML file for sharing.
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
exports.visualizeKnowledgeBase = visualizeKnowledgeBase;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const graph_builder_1 = require("../utils/graph-builder");
const html_builder_1 = require("../utils/html-builder");
const logger_1 = require("../logger");
async function visualizeKnowledgeBase(rootDir, context) {
    (0, logger_1.log)('\n🔭  Building knowledge graph…');
    // ── 1. Build graph data ──────────────────────────────────────────────────
    const graphData = (0, graph_builder_1.buildGraphData)(rootDir, 'all');
    (0, logger_1.log)(`    ✓ ${graphData.metadata.nodeCount} nodes, ${graphData.metadata.edgeCount} edges`);
    // ── 2. Generate HTML ─────────────────────────────────────────────────────
    const html = (0, html_builder_1.buildKnowledgeGraphHtml)(graphData);
    // ── 3. Save HTML file ────────────────────────────────────────────────────
    const sessionsDir = (vscode.workspace.getConfiguration('autoSpecKit').get('sessionsDir') || 'spec-kit-sessions');
    const outDir = path.join(rootDir, sessionsDir);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().slice(0, 10);
    const htmlFile = path.join(outDir, `knowledge-graph-${timestamp}.html`);
    fs.writeFileSync(htmlFile, html, 'utf8');
    (0, logger_1.log)(`    ✓ Saved: ${path.relative(rootDir, htmlFile)}`);
    // ── 4. Open VS Code Webview ──────────────────────────────────────────────
    const panel = vscode.window.createWebviewPanel('autoSpecKitGraph', '🔭 Knowledge Graph — ' + graphData.metadata.projectName, vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    panel.webview.html = html;
    // ── 5. Handle messages from webview (node clicks) ────────────────────────
    panel.webview.onDidReceiveMessage((msg) => {
        if (msg.command === 'openFile' && msg.filePath) {
            const abs = path.join(rootDir, msg.filePath);
            if (fs.existsSync(abs)) {
                vscode.workspace.openTextDocument(abs).then(doc => {
                    vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);
                });
            }
        }
    }, undefined, context.subscriptions);
    // ── 6. Notify ────────────────────────────────────────────────────────────
    vscode.window.showInformationMessage(`🔭 Knowledge Graph ready — ${graphData.metadata.nodeCount} nodes | HTML saved to ${path.basename(htmlFile)}`, 'Open HTML in Browser').then(choice => {
        if (choice === 'Open HTML in Browser') {
            vscode.env.openExternal(vscode.Uri.file(htmlFile));
        }
    });
    (0, logger_1.log)(`\n✅  Knowledge graph opened in webview + saved to ${path.relative(rootDir, htmlFile)}`);
}
