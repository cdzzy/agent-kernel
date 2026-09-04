/**
 * Tests for the work-stealing scheduler (v0.4.0).
 */

import { describe, it, expect, vi } from 'vitest';
import { WorkStealingPool } from '../src/work-stealer.js';
import { AgentKernel } from '../src/kernel.js';

describe('WorkStealingPool', () => {
  it('enqueues to registered workers only', () => {
    const pool = new WorkStealingPool();
    pool.registerWorker('w1');
    expect(() => pool.enqueue('ghost', { name: 'x', run: async () => 1 })).toThrow(/not registered/);
    expect(() => pool.stealFor('ghost')).toThrow(/not registered/);
  });

  it('steals from the busiest victim above the threshold', () => {
    const pool = new WorkStealingPool({ stealThreshold: 1 });
    pool.registerWorker('busy');
    pool.registerWorker('idle');

    const a = pool.enqueue('busy', { name: 'a', run: async () => 1 });
    const b = pool.enqueue('busy', { name: 'b', run: async () => 2 });

    const { task, victim } = pool.stealFor('idle');
    expect(victim).toBe('busy');
    expect(task).not.toBeNull();
    expect(task!.name).toBe('a'); // FIFO: oldest stolen first
    expect(task!.owner).toBe('idle');
    expect(pool.stats().queuedByWorker['busy']).toBe(1);
    expect(pool.stats().stolen).toBe(1);
  });

  it('respects stealThreshold (never empties a worker below it)', () => {
    const pool = new WorkStealingPool({ stealThreshold: 2 });
    pool.registerWorker('busy');
    pool.registerWorker('idle');
    pool.enqueue('busy', { name: 'a', run: async () => 1 });
    pool.enqueue('busy', { name: 'b', run: async () => 2 });

    const { task } = pool.stealFor('idle');
    expect(task).toBeNull(); // 2 queued <= threshold 2 → not stealable
  });

  it('never steals from itself', () => {
    const pool = new WorkStealingPool({ stealThreshold: 0 });
    pool.registerWorker('solo');
    pool.enqueue('solo', { name: 'a', run: async () => 1 });
    pool.enqueue('solo', { name: 'b', run: async () => 2 });
    pool.enqueue('solo', { name: 'c', run: async () => 3 });

    const { task } = pool.stealFor('solo');
    expect(task).toBeNull();
  });

  it('picks the busiest victim when several qualify', () => {
    const pool = new WorkStealingPool({ stealThreshold: 1 });
    pool.registerWorker('w1');
    pool.registerWorker('w2');
    pool.registerWorker('w3');

    pool.enqueue('w1', { name: '1', run: async () => 1 });
    pool.enqueue('w1', { name: '2', run: async () => 2 });
    pool.enqueue('w2', { name: '3', run: async () => 3 });
    pool.enqueue('w2', { name: '4', run: async () => 4 });
    pool.enqueue('w2', { name: '5', run: async () => 5 });

    const { victim } = pool.stealFor('w3');
    expect(victim).toBe('w2');
  });

  it('returns null when nothing to steal', () => {
    const pool = new WorkStealingPool();
    pool.registerWorker('a');
    pool.registerWorker('b');
    const { task, victim } = pool.stealFor('a');
    expect(task).toBeNull();
    expect(victim).toBeNull();
  });

  it('rebalance submits stolen tasks through the kernel', async () => {
    const pool = new WorkStealingPool({ stealThreshold: 1, maxSteal: 2 });
    pool.registerWorker('busy');
    pool.registerWorker('idle');

    const run = vi.fn(async () => 'ok');
    pool.enqueue('busy', { name: 'job-1', run });
    pool.enqueue('busy', { name: 'job-2', run });

    const kernel = new AgentKernel();
    kernel.register('busy');
    kernel.register('idle');
    kernel.start();

    const moved = await pool.rebalance(kernel);
    // idle worker steals up to maxSteal (2); busy keeps 0 (threshold 1 but queue drained)
    expect(moved).toBeGreaterThanOrEqual(1);
    expect(pool.stats().totalQueued).toBeLessThan(2);

    // Wait for kernel tasks to complete
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalled();
    });
    kernel.shutdown();
  });

  it('rebalance skips busy workers', async () => {
    const pool = new WorkStealingPool({ stealThreshold: 0 });
    pool.registerWorker('busy');
    pool.registerWorker('idle');

    pool.enqueue('busy', { name: 'a', run: async () => 1 });
    pool.enqueue('idle', { name: 'b', run: async () => 2 }); // idle has work → not a thief

    const kernel = new AgentKernel();
    kernel.register('busy');
    kernel.register('idle');

    const moved = await pool.rebalance(kernel);
    expect(moved).toBe(0);
    expect(pool.stats().totalQueued).toBe(2);
  });
});
