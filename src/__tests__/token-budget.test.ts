import { estimateTokens, getModelLimit, allocateBudget, truncateToTokens, modelInputBudget } from '../utils/token-budget';

describe('getModelLimit / modelInputBudget', () => {
  it('knows Claude Opus 4.8 (200k)', () => {
    expect(getModelLimit('claude-opus-4-8')).toBe(200_000);
  });
  it('falls back to default for unknown models', () => {
    expect(getModelLimit('totally-unknown')).toBe(128_000);
  });
  it('prefers the live API limit when smaller than the table', () => {
    const b = modelInputBudget({ id: 'claude-opus-4-8', maxInputTokens: 32_000 }, 8_000);
    expect(b).toBeLessThan(32_000);
    expect(b).toBeGreaterThan(8_000);
  });
  it('uses the table when no API limit is provided', () => {
    expect(modelInputBudget({ id: 'claude-opus-4-8' })).toBeGreaterThan(150_000);
  });
});

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate ~1 token per 4 chars', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('should ceil the result', () => {
    expect(estimateTokens('hello')).toBe(2); // 5/4 = 1.25 → 2
  });
});

describe('getModelLimit', () => {
  it('should return known limit for gpt-5.5', () => {
    expect(getModelLimit('gpt-5.5')).toBe(200_000);
  });

  it('should return default for unknown model', () => {
    expect(getModelLimit('unknown-model-xyz')).toBe(128_000);
  });

  it('should match partial model ID', () => {
    expect(getModelLimit('copilot-claude-sonnet-4-6-preview')).toBe(200_000);
  });
});

describe('allocateBudget', () => {
  it('should allocate within model limit', () => {
    const budget = allocateBudget('gpt-5.5', 1000, 2000, 50000, 10000, 5000);
    const total = budget.system + budget.kb + budget.reviewSkills +
                  budget.gitContext + budget.userPrompt + budget.outputReserve;
    expect(total).toBeLessThanOrEqual(200_000);
  });

  it('should preserve system and userPrompt fully when possible', () => {
    const budget = allocateBudget('gpt-5.5', 1000, 2000, 5000, 3000, 1000);
    expect(budget.system).toBe(1000);
    expect(budget.userPrompt).toBe(2000);
  });

  it('should truncate variable content when budget tight', () => {
    const budget = allocateBudget('o4-mini', 1000, 2000, 500000, 100000, 50000);
    expect(budget.kb).toBeLessThan(500000);
    expect(budget.reviewSkills).toBeLessThan(100000);
  });
});

describe('truncateToTokens', () => {
  it('should return unchanged if within budget', () => {
    expect(truncateToTokens('hello', 1000)).toBe('hello');
  });

  it('should truncate with marker when over budget', () => {
    const longText = 'x'.repeat(10000);
    const result = truncateToTokens(longText, 100, 'test');
    expect(result.length).toBeLessThan(longText.length);
    expect(result).toContain('truncated');
  });

  it('should handle empty string', () => {
    expect(truncateToTokens('', 100)).toBe('');
  });
});
