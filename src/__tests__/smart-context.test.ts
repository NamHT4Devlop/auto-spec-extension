import { selectKBTopicsForQuestion } from '../utils/smart-context';
import { orchestratorConfigFor } from '../utils/agent-orchestrator';

describe('orchestratorConfigFor (token-optimized merge)', () => {
  it("auto => structured (no LLM merge) for review steps", () => {
    const cfg = orchestratorConfigFor({ mergeStrategy: 'auto', maxParallelAgents: 3 }, 'review', 4);
    expect(cfg.mergeStrategy).toBe('structured');
    expect(cfg.maxParallel).toBe(3); // min(4, 3)
  });

  it('auto => ai merge for generative steps', () => {
    const cfg = orchestratorConfigFor({ mergeStrategy: 'auto', maxParallelAgents: 3 }, 'generative', 3);
    expect(cfg.mergeStrategy).toBe('ai');
  });

  it('explicit strategy overrides auto', () => {
    const cfg = orchestratorConfigFor({ mergeStrategy: 'concat', maxParallelAgents: 6 }, 'review', 4);
    expect(cfg.mergeStrategy).toBe('concat');
    expect(cfg.maxParallel).toBe(4); // min(4, 6)
  });
});

describe('selectKBTopicsForQuestion (token-optimized ask)', () => {
  it('selects security topic for an auth question', () => {
    const topics = selectKBTopicsForQuestion('Why does the login token expire too early?');
    expect(topics).toContain('security');
    // base topics always included for grounding
    expect(topics).toContain('architecture');
    expect(topics).toContain('conventions');
  });

  it('selects errors topic when investigating an issue', () => {
    const topics = selectKBTopicsForQuestion('Investigate this issue: NullPointerException on checkout');
    expect(topics).toContain('errors');
  });

  it('selects database topic for schema questions', () => {
    const topics = selectKBTopicsForQuestion('Which table stores the order migration?');
    expect(topics).toContain('database');
  });

  it('does not return the full topic set for a focused question', () => {
    const topics = selectKBTopicsForQuestion('How is authentication handled?');
    // security + base, not every topic — proves we are narrowing context
    expect(topics).toContain('security');
    expect(topics).not.toContain('integrations');
  });

  it('falls back to all topics when nothing matches', () => {
    const topics = selectKBTopicsForQuestion('xyzzy qwerty zzzz');
    expect(topics.length).toBeGreaterThan(5);
  });
});
