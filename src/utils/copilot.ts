import * as vscode from 'vscode';
import { log, logRaw } from '../logger';

export async function callCopilot(
  model: vscode.LanguageModelChat,
  systemContext: string,
  userPrompt: string,
  token: vscode.CancellationToken,
  stepLabel: string
): Promise<string> {
  log(`\nℹ  AI › ${stepLabel} ...`);
  log('·'.repeat(64));

  // vscode.lm doesn't have a separate "system" role for all models,
  // so we prepend the system context as a User turn.
  const messages = [
    vscode.LanguageModelChatMessage.User(
      `SYSTEM CONTEXT (follow strictly):\n${systemContext}\n\n---\n\nUSER REQUEST:\n${userPrompt}`
    ),
  ];

  const response = await model.sendRequest(messages, {}, token);

  let result = '';
  for await (const chunk of response.stream) {
    if (chunk instanceof vscode.LanguageModelTextPart) {
      result += chunk.value;
      logRaw(chunk.value);  // stream to output channel in real-time
    }
  }
  // ensure newline after streaming
  const ch = (await import('../logger')).getChannel();
  ch.appendLine('');
  log('·'.repeat(64));
  return result;
}
