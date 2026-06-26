import { settledBatch } from '../workflow/generate-kb';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('settledBatch — real concurrency limiting', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(15);
      active--;
      return true;
    });

    await settledBatch(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('runs every task and preserves input order in results', async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => async () => {
      await sleep(5 - (i % 3)); // finish out of order
      return i;
    });

    const results = await settledBatch(tasks, 2);
    expect(results).toHaveLength(7);
    expect(results.map(r => (r.status === 'fulfilled' ? r.value : -1))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('isolates failures — one rejection does not sink the batch', async () => {
    const tasks = [
      async () => 'a',
      async () => { throw new Error('boom'); },
      async () => 'c',
    ];

    const results = await settledBatch(tasks, 2);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' });
  });

  it('does not start tasks eagerly — defers invocation until a worker is free', async () => {
    const started: number[] = [];
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      started.push(i);
      await sleep(10);
      return i;
    });

    const p = settledBatch(tasks, 2);
    // Synchronously after the call, at most `concurrency` tasks have begun.
    expect(started.length).toBeLessThanOrEqual(2);
    await p;
    expect(started.length).toBe(6);
  });
});
