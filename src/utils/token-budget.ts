/**
 * token-budget.ts
 * Estimates token counts and manages context budgets to prevent overflow.
 *
 * Uses a simple heuristic: ~4 chars per token for English text/code.
 * This is intentionally conservative — better to truncate slightly early
 * than to hit model limits and get errors.
 */

/** Approximate token count using char-based heuristic */
export function estimateTokens(text: string): number {
  if (!text) { return 0; }
  // ~4 chars per token for English/code (conservative)
  return Math.ceil(text.length / 4);
}

/** Model token limits (input) — conservative estimates */
const MODEL_LIMITS: Record<string, number> = {
  'gpt-5.5':          200_000,
  'gpt-5.4':          200_000,
  'gpt-5':            128_000,
  'claude-opus-4-7':  200_000,
  'claude-opus-4-6':  200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
  'gemini-2.5-pro':   1_000_000,
  'o3':               200_000,
  'o4-mini':          128_000,
  'gpt-4o':           128_000,
  'default':          128_000,
};

/** Get the token limit for a model ID */
export function getModelLimit(modelId: string): number {
  const id = modelId.toLowerCase();
  for (const [key, limit] of Object.entries(MODEL_LIMITS)) {
    if (id.includes(key)) { return limit; }
  }
  return MODEL_LIMITS['default'];
}

export interface BudgetAllocation {
  system: number;
  kb: number;
  reviewSkills: number;
  gitContext: number;
  userPrompt: number;
  /** Reserved for model output */
  outputReserve: number;
}

/**
 * Calculate token budget allocation for a Copilot call.
 * Ensures total input tokens stay within model limit.
 *
 * Priority order (highest first):
 *   1. System prompt (always full)
 *   2. User prompt (always full)
 *   3. Output reserve (fixed)
 *   4. Knowledge Base (truncated if needed)
 *   5. Review Skills (truncated if needed)
 *   6. Git Context (truncated if needed)
 */
export function allocateBudget(
  modelId: string,
  systemTokens: number,
  userPromptTokens: number,
  kbTokens: number,
  reviewSkillsTokens: number,
  gitContextTokens: number,
  outputReserve: number = 16_000,
): BudgetAllocation {
  const limit = getModelLimit(modelId);
  const safeLimit = Math.floor(limit * 0.9); // 10% safety margin

  // Fixed allocations
  const fixedTotal = systemTokens + userPromptTokens + outputReserve;

  if (fixedTotal >= safeLimit) {
    // Even fixed content exceeds limit — truncate user prompt
    return {
      system: systemTokens,
      kb: 0,
      reviewSkills: 0,
      gitContext: 0,
      userPrompt: Math.max(1000, safeLimit - systemTokens - outputReserve),
      outputReserve,
    };
  }

  // Remaining budget for variable content
  let remaining = safeLimit - fixedTotal;

  // Allocate KB (highest priority variable content)
  const kbAlloc = Math.min(kbTokens, Math.floor(remaining * 0.5));
  remaining -= kbAlloc;

  // Allocate review skills
  const rsAlloc = Math.min(reviewSkillsTokens, Math.floor(remaining * 0.5));
  remaining -= rsAlloc;

  // Allocate git context (whatever is left)
  const gitAlloc = Math.min(gitContextTokens, remaining);

  return {
    system: systemTokens,
    kb: kbAlloc,
    reviewSkills: rsAlloc,
    gitContext: gitAlloc,
    userPrompt: userPromptTokens,
    outputReserve,
  };
}

/**
 * Truncate text to fit within a token budget.
 * Truncates from the end, adding a marker.
 */
export function truncateToTokens(text: string, maxTokens: number, label?: string): string {
  if (!text) { return text; }
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) { return text; }

  // Truncate to approximate char count
  const maxChars = maxTokens * 4;
  const marker = `\n\n... [${label ?? 'content'} truncated — ${estimated} tokens → ${maxTokens} tokens] ...`;
  return text.slice(0, maxChars - marker.length) + marker;
}
