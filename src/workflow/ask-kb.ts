import * as vscode from 'vscode';

import { log, banner } from '../logger';
import { callCopilot } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';

export async function askAboutCodebase(
  question: string,
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken
): Promise<void> {

  const cfg       = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');

  // 1. Load KB
  const kb = loadKnowledgeBase(workspaceRoot, kbRelPath);

  // 2. Build SYSTEM
  const SYSTEM = `You are an expert on this codebase. Answer questions based ONLY on the knowledge base below.\n\n=== KNOWLEDGE BASE ===\n${kb}`;

  // 3. Log banner
  banner(['💬 ASK ABOUT CODEBASE', `Q: ${question.slice(0, 60)}`]);
  log(`ℹ  Question: ${question}\n`);

  // 4. Call Copilot
  const answer = await callCopilot(model, SYSTEM, question, token, 'Ask About Codebase');

  // 5. Build result document
  const content = `# 💬 Answer: ${question.slice(0, 80)}
_${new Date().toLocaleString('en-US')}_

---

${answer}
`;

  // 6. Open document
  const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

  log(`\n✅ Answer displayed in new document.`);
}
