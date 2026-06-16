/**
 * visualize-kb.ts — Knowledge Graph with AI Enrichment
 *
 * Flow:
 *   1. Static scan → graph-builder.ts (multi-language, method-level)
 *   2. AI enrichment → graph-enricher.ts (business flows, entity relations, arch validation)
 *   3. Render → html-builder.ts → D3.js webview + .html file
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { buildGraphData } from '../utils/graph-builder';
import { enrichGraphWithAI } from '../utils/graph-enricher';
import { buildKnowledgeGraphHtml } from '../utils/html-builder';
import { resolveModel } from '../utils/model-selector';
import { log } from '../logger';

export async function visualizeKnowledgeBase(
  rootDir: string,
  context: vscode.ExtensionContext
): Promise<void> {
  log('\n🔭  Building knowledge graph…');

  // ── 1. Static scan ──────────────────────────────────────────────
  log('📊 Phase 1: Static analysis (multi-language deep scan)...');
  let graphData = buildGraphData(rootDir, 'all');
  log(`    ✓ ${graphData.metadata.nodeCount} nodes, ${graphData.metadata.edgeCount} edges`);
  log(`    Languages: ${graphData.metadata.languages.join(', ')}`);
  log(`    Scan time: ${graphData.metadata.scanDurationMs}ms`);

  // ── 2. AI enrichment (optional — needs Copilot model) ──────────
  const enrichChoice = await vscode.window.showQuickPick(
    [
      { label: '🧠 Yes — Enrich with AI (business flows, entity maps, arch validation)', enrich: true },
      { label: '⚡ No — Use static graph only (faster)', enrich: false },
    ],
    {
      title: 'AI-Enhanced Knowledge Graph',
      placeHolder: `Static scan found ${graphData.metadata.nodeCount} nodes. Enrich with AI for deeper analysis?`,
    }
  );

  if (enrichChoice?.enrich) {
    const model = await resolveModel();
    if (model) {
      const cts = new vscode.CancellationTokenSource();
      context.subscriptions.push(cts);

      log('🧠 Phase 2: AI enrichment (3 parallel agents)...');
      try {
        graphData = await enrichGraphWithAI(graphData, model, cts.token);
        log(`    ✓ Enriched: ${graphData.metadata.nodeCount} nodes, ${graphData.metadata.edgeCount} edges`);
      } catch (err: any) {
        log(`    ⚠ AI enrichment failed: ${err?.message ?? err}`);
        log(`    Continuing with static graph.`);
      }
    }
  }

  // ── 3. Generate HTML ────────────────────────────────────────────
  const html = buildKnowledgeGraphHtml(graphData);

  // ── 4. Save HTML file ──────────────────────────────────────────
  const sessionsDir = vscode.workspace.getConfiguration('autoSpecKit').get<string>('sessionsDir') || 'spec-kit-sessions';
  const outDir = path.join(rootDir, sessionsDir);
  if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }

  const timestamp = new Date().toISOString().slice(0, 10);
  const htmlFile = path.join(outDir, `knowledge-graph-${timestamp}.html`);
  fs.writeFileSync(htmlFile, html, 'utf8');
  log(`    ✓ Saved: ${path.relative(rootDir, htmlFile)}`);

  // ── 5. Open VS Code Webview ─────────────────────────────────────
  const panel = vscode.window.createWebviewPanel(
    'autoSpecKitGraph',
    '🔭 Knowledge Graph — ' + graphData.metadata.projectName,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      // No local resources are loaded via webview URIs — lock the root list down.
      localResourceRoots: [],
    }
  );

  panel.webview.html = html;

  // Handle messages from webview (node clicks → open file)
  const rootResolved = path.resolve(rootDir);
  panel.webview.onDidReceiveMessage(
    (msg: { command: string; filePath?: string }) => {
      if (msg.command === 'openFile' && msg.filePath) {
        // Containment guard: reject absolute paths or any traversal that would
        // resolve outside the workspace root before touching the filesystem.
        const rel = String(msg.filePath);
        if (path.isAbsolute(rel)) { log(`⛔ Ignored openFile (absolute path): ${rel}`); return; }
        const abs = path.resolve(rootResolved, rel);
        if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
          log(`⛔ Ignored openFile outside workspace: ${rel}`);
          return;
        }
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          vscode.workspace.openTextDocument(abs).then(doc => {
            vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);
          });
        }
      }
    },
    undefined,
    context.subscriptions
  );

  // ── 6. Notify ───────────────────────────────────────────────────
  const enrichedLabel = enrichChoice?.enrich ? ' (AI-enriched)' : '';
  vscode.window.showInformationMessage(
    `🔭 Knowledge Graph${enrichedLabel} — ${graphData.metadata.nodeCount} nodes, ${graphData.metadata.edgeCount} edges | ${path.basename(htmlFile)}`,
    'Open HTML in Browser'
  ).then(choice => {
    if (choice === 'Open HTML in Browser') {
      vscode.env.openExternal(vscode.Uri.file(htmlFile));
    }
  });

  log(`\n✅  Knowledge graph opened${enrichedLabel}`);
}
