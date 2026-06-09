/**
 * copilot.ts
 * Wrapper for calling GitHub Copilot via the vscode.lm API.
 *
 * Enhancements over original:
 *   - Retry with exponential backoff (up to 3 attempts)
 *   - Token estimation logging
 *   - Timeout protection
 *   - Structured error messages
 */

import * as vscode from 'vscode';
import { log, logRaw } from '../logger';
import { estimateTokens } from './token-budget';

/** Configuration for retry behavior */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 2000,
  maxDelayMs: 15000,
};

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if error is retryable */
function isRetryable(err: any): boolean {
  const msg = (err?.message ?? '').toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('network') ||
    msg.includes('econnreset')
  );
}

export async function callCopilot(
  model: vscode.LanguageModelChat,
  systemContext: string,
  userPrompt: string,
  token: vscode.CancellationToken,
  stepLabel: string,
  retryConfig: RetryConfig = DEFAULT_RETRY,
): Promise<string> {
  const inputTokens = estimateTokens(systemContext + userPrompt);
  log(`\nℹ  AI › ${stepLabel} (~${inputTokens.toLocaleString()} input tokens)`);
  log('·'.repeat(64));

  const messages = [
    vscode.LanguageModelChatMessage.User(
      `SYSTEM CONTEXT (follow strictly):\n${systemContext}\n\n---\n\nUSER REQUEST:\n${userPrompt}`
    ),
  ];

  let lastError: any;

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    if (token.isCancellationRequested) {
      throw new Error('Cancelled by user');
    }

    try {
      const response = await model.sendRequest(messages, {}, token);

      let result = '';
      for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelTextPart) {
          result += chunk.value;
          logRaw(chunk.value);
        }
      }

      // Ensure newline after streaming
      const { getChannel } = await import('../logger');
      getChannel().appendLine('');
      log('·'.repeat(64));

      const outputTokens = estimateTokens(result);
      log(`ℹ  Tokens: ~${inputTokens.toLocaleString()} in / ~${outputTokens.toLocaleString()} out`);

      return result;
    } catch (err: any) {
      lastError = err;

      if (token.isCancellationRequested) {
        throw err;
      }

      if (attempt < retryConfig.maxAttempts && isRetryable(err)) {
        const delay = Math.min(
          retryConfig.baseDelayMs * Math.pow(2, attempt - 1),
          retryConfig.maxDelayMs,
        );
        log(`⚠  Attempt ${attempt}/${retryConfig.maxAttempts} failed: ${err.message}`);
        log(`   Retrying in ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
        continue;
      }

      // Non-retryable or max attempts reached
      break;
    }
  }

  throw new Error(
    `AI call failed after ${retryConfig.maxAttempts} attempts (${stepLabel}): ${lastError?.message ?? lastError}`
  );
}
