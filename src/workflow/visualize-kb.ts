/**
 * visualize-kb.ts
 * Command: autoSpecKit.visualize
 * Builds a knowledge graph from KB + src, opens a D3.js webview panel,
 * and saves a self-contained HTML file for sharing.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { buildGraphData } from '../utils/graph-builder';
import { buildKnowledgeGraphHtml } from '../utils/html-builder';
import { log } from '../logger';

export async function visualizeKnowledgeBase(
  rootDir: string,
  context: vscode.ExtensionContext
): Promise<void> {
  log('\n🔭  Building knowledge graph…');

  // ── 1. Build graph data ──────────────────────────────────────────────────
  const graphData = buildGraphData(rootDir, 'all');
  log(`    ✓ ${graphData.metadata.nodeCount} nodes, ${graphData.metadata.edgeCount} edges`);

  // ── 2. Generate HTML ─────────────────────────────────────────────────────
  const html = buildKnowledgeGraphHtml(graphData);

  // ── 3. Save HTML file ────────────────────────────────────────────────────
  const sessionsDir = (vscode.workspace.getConfiguration('autoSpecKit').get<string>('sessionsDir') || 'spec-kit-sessions');
  const outDir = path.join(rootDir, sessionsDir);
  if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }

  const timestamp = new Date().toISOString().slice(0, 10);
  const htmlFile = path.join(outDir, `knowledge-graph-${timestamp}.html`);
  fs.writeFileSync(htmlFile, html, 'utf8');
  log(`    ✓ Saved: ${path.relative(rootDir, htmlFile)}`);

  // ── 4. Open VS Code Webview ──────────────────────────────────────────────
  const panel = vscode.window.createWebviewPanel(
    'autoSpecKitGraph',
    '🔭 Knowledge Graph — ' + graphData.metadata.projectName,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = html;

  // ── 5. Handle messages from webview (node clicks) ────────────────────────
  panel.webview.onDidReceiveMessage(
    (msg: { command: string; nodeId?: string; filePath?: string }) => {
      if (msg.command === 'openFile' && msg.filePath) {
        const abs = path.join(rootDir, msg.filePath);
        if (fs.existsSync(abs)) {
          vscode.workspace.openTextDocument(abs).then(doc => {
            vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);
          });
        }
      }
    },
    undefined,
    context.subscriptions
  );

  // ── 6. Notify ────────────────────────────────────────────────────────────
  vscode.window.showInformationMessage(
    `🔭 Knowledge Graph ready — ${graphData.metadata.nodeCount} nodes | HTML saved to ${path.basename(htmlFile)}`,
    'Open HTML in Browser'
  ).then(choice => {
    if (choice === 'Open HTML in Browser') {
      vscode.env.openExternal(vscode.Uri.file(htmlFile));
    }
  });

  log(`\n✅  Knowledge graph opened in webview + saved to ${path.relative(rootDir, htmlFile)}`);
}
