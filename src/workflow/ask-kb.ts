import * as vscode from 'vscode';

import { log, banner } from '../logger';
import { callCopilot } from '../utils/copilot';
import { loadKnowledgeBase } from '../utils/file-utils';
import { selectKBTopicsForQuestion, loadKBForTopics, isVagueQuestion } from '../utils/smart-context';
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

  const vague = isVagueQuestion(question);
  log(`ℹ  KB context: topics [${topics.join(', ')}] (~${estimateTokens(kb).toLocaleString()} tokens)${vague ? ' | ⚠ question looks vague' : ''}`);

  // Ambiguity-safe answering handled in ONE call (no extra model round-trip):
  // the model must surface its interpretation/assumptions and never fabricate.
  const SYSTEM = `You are an expert on this codebase. Answer questions using ONLY the knowledge base below.

=== ANSWERING RULES ===
1. Ground every claim in the knowledge base. If it does not contain the answer, say so explicitly — never invent files, APIs, or behavior.
2. Cite concrete names from the KB (files, modules, endpoints, entities) where relevant.
3. If the question is ambiguous or under-specified:
   a) First, briefly state how you INTERPRET the question and the ASSUMPTIONS you are making.
   b) Then answer the most likely intent as best the KB allows.
   c) Finally, list 2–3 specific CLARIFYING QUESTIONS (or alternative interpretations) so the user can refine.
4. Prefer a precise, scoped answer over a broad, hedged one.

=== KNOWLEDGE BASE (relevant subset) ===
${kb}`;

  const userMessage = vague
    ? `${question}\n\n[NOTE: This question appears broad or under-specified. Begin by stating your interpretation and assumptions, then answer the most likely intent, then ask focused clarifying questions.]`
    : question;

  banner(['💬 ASK ABOUT CODEBASE', `Q: ${question.slice(0, 60)}`]);
  log(`ℹ  Question: ${question}\n`);

  const answer = await callCopilot(model, SYSTEM, userMessage, token, 'Ask About Codebase');

  const content = `# 💬 Answer: ${question.slice(0, 80)}
_${new Date().toLocaleString('en-US')}_

---

${answer}
`;

  const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

  log(`\n✅ Answer displayed in new document.`);
}
