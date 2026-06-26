import { modelScore } from '../utils/model-selector';

const s = (id: string) => modelScore({ id, family: id });

describe('modelScore — Copilot model ranking', () => {
  it('ranks Claude Opus 4.8 as the flagship (highest)', () => {
    expect(s('claude-opus-4-8')).toBe(100);
    expect(s('claude-opus-4-8')).toBeGreaterThan(s('claude-opus-4-7'));
    expect(s('claude-opus-4-7')).toBeGreaterThan(s('claude-opus-4-6'));
  });

  it('matches variant ids before the base (no base-key collision)', () => {
    // gpt-5.4-mini must NOT inherit the gpt-5.4 base score
    expect(s('gpt-5.4-mini')).toBe(82);
    expect(s('gpt-5.4')).toBe(95);
    expect(s('gpt-5.4-nano')).toBe(60);
    // opus fast-mode distinct from base opus-4-6
    expect(s('claude-opus-4-6-fast')).toBe(90);
    expect(s('claude-opus-4-6')).toBe(95);
  });

  it('includes the newly added models', () => {
    expect(s('gpt-5.5')).toBe(99);
    expect(s('mai-code-1-flash')).toBe(66);
    expect(s('gemini-3.1-pro')).toBe(88);
  });

  it('keeps the currently-unavailable Claude Fable 5 low so it is never auto-selected', () => {
    expect(s('claude-fable-5')).toBeLessThan(s('claude-haiku-4-5'));
  });

  it('falls back to a middle score for genuinely unknown models', () => {
    expect(s('some-future-model-x')).toBe(40);
  });

  // Regression: real Copilot ids don't literally contain the version-specific
  // priority keys (e.g. `claude-opus-4`, not `claude-opus-4-8`). These must
  // still rank as top-tier via family fallback, not sink to ⚠ (40).
  describe('family fallback for real Copilot ids', () => {
    it('ranks any Claude Opus as top-tier (⭐ ≥ 90... or at least ≥ 50)', () => {
      for (const id of ['claude-opus-4', 'claude-opus-41', 'claude-opus-45']) {
        expect(s(id)).toBeGreaterThanOrEqual(90);
      }
    });

    it('ranks any Claude Sonnet as good (≥ 70, never ⚠)', () => {
      for (const id of ['claude-sonnet-4', 'claude-sonnet-45', 'claude-3.7-sonnet', 'claude-3.5-sonnet']) {
        expect(s(id)).toBeGreaterThanOrEqual(70);
      }
    });

    it('ranks GPT-5 / Codex variants high without exact version keys', () => {
      expect(s('gpt-5')).toBeGreaterThanOrEqual(90);
      expect(s('gpt-5-codex')).toBeGreaterThanOrEqual(90);
      expect(s('gpt-5-mini-2026')).toBeGreaterThanOrEqual(70);
    });

    it('ranks Gemini Pro above Gemini Flash', () => {
      expect(s('gemini-4-pro')).toBeGreaterThan(s('gemini-4-flash'));
    });

    it('never tags a current Claude/GPT-5 model with the ⚠ (< 50) bucket', () => {
      for (const id of ['claude-opus-4', 'claude-sonnet-4', 'gpt-5', 'gemini-3-pro']) {
        expect(s(id)).toBeGreaterThanOrEqual(50);
      }
    });
  });
});
