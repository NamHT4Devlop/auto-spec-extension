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

  it('falls back to a middle score for unknown models', () => {
    expect(s('some-future-model-x')).toBe(40);
  });
});
