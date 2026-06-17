import * as vscode from 'vscode';

import { log, banner } from '../logger';
import { callCopilot } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';
import { selectKBTopicsForQuestion, loadKBForTopics } from '../utils/smart-context';
import { estimateTokens, truncateToTokens } from '../utils/token-budget';

export async function askAboutCodebase(
  question: string,
  workspaceRoot: string,
  model: vscode.LanguageModelChat,
  token: vscode.CancellationToken
): Promise<void> {

  const cfg       = vscode.workspace.getConfiguration('autoSpecKit');
  const kbRelPath = cfg.get<string>('knowledgeBasePath', 'knowledge-base');
  // Token budget for the KB context injected into a single question.
  const maxKbTokens = cfg.get<number>('ask.maxContextTokens', 24_000);

  // Token optimization: load only KB topics relevant to the question (no extra
  // model call) instead of dumping the entire knowledge base every time.
  const topics = selectKBTopicsForQuestion(question);
  let kb = loadKBForTopics(workspaceRoot, kbRelPath, topics, maxKbTokens);

  // Fallback — if topic selection produced nothing (e.g. non-standard KB layout),
  // load the full KB but cap it to the same budget so we never blow up token usage.
  if (!kb.trim()) {
    const fullKb = loadKnowledgeBase(workspaceRoot, kbRelPath);
    kb = estimateTokens(fullKb) > maxKbTokens
      ? truncateToTokens(fullKb, maxKbTokens, 'knowledge-base')
      : fullKb;
  }

  log(`ℹ  KB context: topics [${topics.join(', ')}] (~${estimateTokens(kb).toLocaleString()} tokens)`);

  const SYSTEM = `You are an expert on this codebase. Answer questions based ONLY on the knowledge base below. If the answer is not covered by the provided context, say so explicitly rather than guessing.\n\n=== KNOWLEDGE BASE (relevant subset) ===\n${kb}`;

  banner(['💬 ASK ABOUT CODEBASE', `Q: ${question.slice(0, 60)}`]);
  log(`ℹ  Question: ${question}\n`);

  const answer = await callCopilot(model, SYSTEM, question, token, 'Ask About Codebase');

  const content = `# 💬 Answer: ${question.slice(0, 80)}
_${new Date().toLocaleString('en-US')}_

---

${answer}
`;

  const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

  log(`\n✅ Answer displayed in new document.`);
}
