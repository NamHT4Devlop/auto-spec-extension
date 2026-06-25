import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { log, banner } from '../logger';
import { callCopilot, resetTokenMeter, formatTokenUsage } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';
import { selectKBTopicsForQuestion, loadKBForTopics, isVagueQuestion, loadMatchingModuleDocs } from '../utils/smart-context';
import { estimateTokens, truncateToTokens } from '../utils/token-budget';
import { buildDocumentHtml } from '../utils/html-builder';

export async function askAboutCodebase(
  question: string,
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken
): Promise<void> {

  resetTokenMeter();
  const cfg       = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  const sessionsDir = cfg.get<string>('sessionsDir', 'spec-kit-sessions');
  // Token budget for the KB context injected into a single question.
  const maxKbTokens = cfg.get<number>('ask.maxContextTokens', 24_000);

  // Token optimization: load only KB topics relevant to the question (no extra
  // model call) instead of dumping the entire knowledge base every time.
  const topics = selectKBTopicsForQuestion(question);

  // Per-module deep docs are the most relevant context when a question names a
  // module/feature — load those first (up to half the budget), then fill with topics.
  const moduleDocs = loadMatchingModuleDocs(workspaceRoot, kbRelPath, question, Math.floor(maxKbTokens * 0.5));
  const topicBudget = Math.max(4000, maxKbTokens - estimateTokens(moduleDocs));
  const topicKb = loadKBForTopics(workspaceRoot, kbRelPath, topics, topicBudget);
  let kb = [moduleDocs, topicKb].filter(Boolean).join('\n\n---\n\n');

  // Fallback — if topic selection produced nothing (e.g. non-standard KB layout),
  // load the full KB but cap it to the same budget so we never blow up token usage.
  if (!kb.trim()) {
    const fullKb = loadKnowledgeBase(workspaceRoot, kbRelPath);
    kb = estimateTokens(fullKb) > maxKbTokens
      ? truncateToTokens(fullKb, maxKbTokens, 'knowledge-base')
      : fullKb;
  }

  const vague = isVagueQuestion(question);
  log(`ℹ  KB context: topics [${topics.join(', ')}] (~${estimateTokens(kb).toLocaleString()} tokens)${vague ? ' | ⚠ question looks vague' : ''}`);

  // Ambiguity-safe answering handled in ONE call (no extra model round-trip):
  // the model must surface its interpretation/assumptions and never fabricate.
  const SYSTEM = `You are a Business Analyst AND engineer explaining this codebase to a MIXED audience (business + technical). Answer using ONLY the knowledge base below.

Structure every answer in this order:

## In plain language
Explain for a NON-technical reader (a BA / product / business person): what it is, why it matters, and how it behaves — in everyday business terms, no jargon. Use an analogy if helpful.

## Diagram
Draw a Mermaid diagram that fits the question (flowchart for a flow, erDiagram for data/fields, sequenceDiagram for an interaction). Wrap it EXACTLY in a \`\`\`mermaid code block with valid Mermaid syntax. Keep node labels short and plain. If a diagram truly does not apply, write "(no diagram needed)".

## Technical detail
The precise technical answer, citing concrete names from the KB (files, modules, endpoints, entities, fields).

=== RULES ===
1. Ground every claim in the knowledge base. If it does not contain the answer, say so explicitly — never invent files, APIs, fields or behavior.
2. When mapping business ↔ code, name the exact field/file/function.
3. If the question is ambiguous, first state your interpretation + assumptions, answer the most likely intent, then ask 2–3 clarifying questions.

=== KNOWLEDGE BASE (relevant subset) ===
${kb}`;

  const userMessage = vague
    ? `${question}\n\n[NOTE: This question appears broad or under-specified. Begin by stating your interpretation and assumptions, then answer the most likely intent, then ask focused clarifying questions.]`
    : question;

  banner(['💬 ASK ABOUT CODEBASE', `Q: ${question.slice(0, 60)}`]);
  log(`ℹ  Question: ${question}\n`);

  const answer = await callCopilot(model, SYSTEM, userMessage, token, 'Ask About Codebase');

  const usage = formatTokenUsage();
  log(`\n📊 Token usage (this question): ${usage}`);

  const md = `# 💬 ${question.slice(0, 90)}
_${new Date().toLocaleString('en-US')}_

${answer}

---
_Token usage: ${usage}_
`;

  // Render to HTML (with the Mermaid diagram drawn) and open a webview, plus offer browser.
  const outDir = path.join(workspaceRoot, sessionsDir, 'answers');
  fs.mkdirSync(outDir, { recursive: true });
  const slug = (question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50)) || 'answer';
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const htmlFile = path.join(outDir, `${slug}-${ts}.html`);
  const html = buildDocumentHtml(question, md);
  fs.writeFileSync(htmlFile, html, 'utf-8');

  const panel = vscode.window.createWebviewPanel(
    'autoSpecKitAnswer', `💬 ${question.slice(0, 40)}`, vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );
  panel.webview.html = html;

  // Also open the Markdown for quick copy/editing.
  const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Two });

  vscode.window.showInformationMessage(
    `💬 Answer ready · ${usage}`, 'Open HTML in Browser',
  ).then(c => { if (c === 'Open HTML in Browser') { vscode.env.openExternal(vscode.Uri.file(htmlFile)); } });

  log(`\n✅ Answer displayed (HTML: ${path.relative(workspaceRoot, htmlFile)}).`);
}
