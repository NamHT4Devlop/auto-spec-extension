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
import { estimateTokens, truncateToTokens, modelInputBudget } from './token-budget';

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

// ─── Token meter ───────────────────────────────────────────────────────────────
// Accumulates token usage so each task can report how much it spent.
interface TokenMeter { inputTokens: number; outputTokens: number; calls: number; }
let _meter: TokenMeter = { inputTokens: 0, outputTokens: 0, calls: 0 };

/** Reset the token meter at the start of a task. */
export function resetTokenMeter(): void { _meter = { inputTokens: 0, outputTokens: 0, calls: 0 }; }

/** Read the accumulated token usage for the current task. */
export function getTokenMeter(): TokenMeter { return { ..._meter }; }

/** Human-readable summary of token usage so far. */
export function formatTokenUsage(): string {
  const { inputTokens, outputTokens, calls } = _meter;
  const total = inputTokens + outputTokens;
  return `~${total.toLocaleString()} tokens (${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out) across ${calls} AI call${calls === 1 ? '' : 's'}`;
}

/** Check if error is a token/context-limit error (so we can shrink & retry). */
function isTokenLimitError(err: any): boolean {
  const msg = (err?.message ?? '').toLowerCase();
  return (
    msg.includes('token limit') ||
    msg.includes('exceeds token') ||
    msg.includes('context length') ||
    msg.includes('context window') ||
    msg.includes('too long') ||
    msg.includes('maximum context') ||
    msg.includes('input is too large')
  );
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
  // ── Universal token-limit guard ──────────────────────────────────────────────
  // EVERY task goes through callCopilot, so fitting here makes ALL tasks limit-safe:
  // no call can exceed the model's input limit (→ no "Message exceeds token limit").
  // `effBudget` shrinks if a limit error still slips past the estimate (self-healing).
  const overhead = 60; // wrapper/labels below
  let effBudget = modelInputBudget(model as any);

  // Idle timeout: abort a stalled request if no stream activity for this long.
  // Resets on every chunk, so slow-but-progressing responses are NOT killed —
  // only true hangs (which previously froze the whole run for hours).
  const idleMs = Math.max(
    20_000,
    vscode.workspace.getConfiguration('autoSpecKit').get<number>('callTimeoutMs', 150_000),
  );

  /** Fit system + user into the current budget; returns the combined message text. */
  const buildMessage = (): { text: string; tokens: number } => {
    let sysCtx = systemContext;
    let usrPrompt = userPrompt;
    if (estimateTokens(sysCtx) + estimateTokens(usrPrompt) + overhead > effBudget) {
      const before = estimateTokens(sysCtx) + estimateTokens(usrPrompt);
      const usrCap = Math.min(estimateTokens(usrPrompt), Math.floor(effBudget * 0.6));
      usrPrompt = truncateToTokens(usrPrompt, usrCap, 'prompt');
      const sysCap = Math.max(500, effBudget - estimateTokens(usrPrompt) - overhead);
      sysCtx = truncateToTokens(sysCtx, sysCap, 'context');
      log(`⚠  ${stepLabel}: context ~${before.toLocaleString()} tok > budget ~${effBudget.toLocaleString()} — auto-trimmed to fit.`);
    }
    const text = `SYSTEM CONTEXT (follow strictly):\n${sysCtx}\n\n---\n\nUSER REQUEST:\n${usrPrompt}`;
    return { text, tokens: estimateTokens(text) };
  };

  let built = buildMessage();
  log(`\nℹ  AI › ${stepLabel} (~${built.tokens.toLocaleString()} input tokens)`);
  log('·'.repeat(64));

  let lastError: any;

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    if (token.isCancellationRequested) {
      throw new Error('Cancelled by user');
    }

    const messages = [vscode.LanguageModelChatMessage.User(built.text)];

    // Per-attempt idle-timeout watchdog (cancels a stalled request).
    const cts = new vscode.CancellationTokenSource();
    const outerSub = token.onCancellationRequested(() => cts.cancel());
    let timedOut = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      if (idleTimer) { clearTimeout(idleTimer); }
      idleTimer = setTimeout(() => { timedOut = true; cts.cancel(); }, idleMs);
    };

    try {
      armIdle();
      const response = await model.sendRequest(messages, {}, cts.token);

      let result = '';
      for await (const chunk of response.stream) {
        armIdle(); // activity → reset the idle watchdog
        if (chunk instanceof vscode.LanguageModelTextPart) {
          result += chunk.value;
          logRaw(chunk.value);
        }
      }
      if (idleTimer) { clearTimeout(idleTimer); }

      // Ensure newline after streaming
      const { getChannel } = await import('../logger');
      getChannel().appendLine('');
      log('·'.repeat(64));

      const outputTokens = estimateTokens(result);
      _meter.inputTokens += built.tokens;
      _meter.outputTokens += outputTokens;
      _meter.calls += 1;
      log(`ℹ  Tokens: ~${built.tokens.toLocaleString()} in / ~${outputTokens.toLocaleString()} out  ·  task total: ~${(_meter.inputTokens + _meter.outputTokens).toLocaleString()}`);

      return result;
    } catch (err: any) {
      if (idleTimer) { clearTimeout(idleTimer); }

      // Real user cancellation (not our watchdog) → propagate.
      if (token.isCancellationRequested && !timedOut) {
        throw err;
      }

      lastError = timedOut
        ? new Error(`No response for ${Math.round(idleMs / 1000)}s — request stalled`)
        : err;

      // Self-heal: token-limit slipped past the estimate → shrink and retry.
      if (attempt < retryConfig.maxAttempts && isTokenLimitError(err)) {
        effBudget = Math.max(2_000, Math.floor(effBudget * 0.5));
        built = buildMessage();
        log(`⚠  ${stepLabel}: token-limit hit — shrinking context to ~${effBudget.toLocaleString()} tok and retrying...`);
        continue;
      }

      // Stalled request or transient error → retry.
      if (attempt < retryConfig.maxAttempts && (timedOut || isRetryable(err))) {
        const delay = timedOut
          ? 1500
          : Math.min(retryConfig.baseDelayMs * Math.pow(2, attempt - 1), retryConfig.maxDelayMs);
        log(`⚠  Attempt ${attempt}/${retryConfig.maxAttempts} failed: ${lastError.message}`);
        log(`   Retrying in ${(delay / 1000).toFixed(1)}s...`);
        await sleep(delay);
        continue;
      }

      // Non-retryable or max attempts reached
      break;
    } finally {
      outerSub.dispose();
      cts.dispose();
    }
  }

  throw new Error(
    `AI call failed after ${retryConfig.maxAttempts} attempts (${stepLabel}): ${lastError?.message ?? lastError}`
  );
}
