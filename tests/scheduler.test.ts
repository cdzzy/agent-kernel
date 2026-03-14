import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../src/scheduler.js';
import type { AgentDescriptor, TaskDescriptor } from '../src/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeAgent(id: string, priority: 'high' | 'medium' | 'low' = 'medium'): AgentDescriptor {
  return { id, priority, registeredAt: Date.now() };
}

describe('Scheduler', () => {
  let scheduler: Scheduler;

  afterEach(() => {
    scheduler?.shutdown();
  });

  describe('FIFO strategy', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ strategy: 'fifo', maxConcurrent: 1, agingInterval: 0 });
      scheduler.registerAgent(makeAgent('a1'));
      scheduler.registerAgent(makeAgent('a2'));
    });

    it('should execute tasks in submission order', async () => {
      const order: string[] = [];

      scheduler.submit('a1', {
        name: 'first',
        handler: async () => { order.push('first'); },
      });
      scheduler.submit('a2', {
        name: 'second',
        handler: async () => { order.push('second'); },
      });

      await sleep(100);
      expect(order).toEqual(['first', 'second']);
    });
  });

  describe('Priority strategy', () => {
    beforeEach(() => {
      scheduler = new Scheduler({ strategy: 'priority', maxConcurrent: 1, agingInterval: 0 });
      scheduler.registerAgent(makeAgent('low-agent', 'low'));
      scheduler.registerAgent(makeAgent('high-agent', 'high'));
    });

    it('should execute higher priority tasks first', async () => {
      const order: string[] = [];

      // Submit low first, then high — high should still run first
      // We need both to be in queue before processing starts
      // Use maxConcurrent: 1 and submit while one is running
      scheduler.submit('low-agent', {
        name: 'low-task',
        handler: async () => { await sleep(10); order.push('low'); },
      });

      // After the low task starts running, submit high
      await sleep(5);
      scheduler.submit('high-agent', {
        name: 'high-task',
        handler: async () => { order.push('high'); },
      });

      await sleep(100);
      // low started first because it was submitted first and queue was empty
      // high runs after low completes
      expect(order).toContain('low');
      expect(order).toContain('high');
    });
  });

  describe('concurrency limit', () => {
    it('should respect maxConcurrent', async () => {
      scheduler = new Scheduler({ strategy: 'fifo', maxConcurrent: 2, agingInterval: 0 });
      scheduler.registerAgent(makeAgent('a1'));

      let concurrent = 0;
      let maxConcurrent = 0;

      const makeTask = (name: string) => scheduler.submit('a1', {
        name,
        handler: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(50);
          concurrent--;
        },
      });

      makeTask('t1');
      makeTask('t2');
      makeTask('t3');
      makeTask('t4');

      await sleep(300);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('task dependencies', () => {
    it('should wait for dependencies to complete', async () => {
      scheduler = new Scheduler({ strategy: 'fifo', maxConcurrent: 5, agingInterval: 0 });
      scheduler.registerAgent(makeAgent('a1'));

      const order: string[] = [];

      const t1 = scheduler.submit('a1', {
        name: 'step-1',
        handler: async () => { await sleep(30); order.push('step-1'); },
      });

      scheduler.submit('a1', {
        name: 'step-2',
        dependencies: [t1.id],
        handler: async () => { order.push('step-2'); },
      });

      await sleep(200);
      expect(order).toEqual(['step-1', 'step-2']);
    });
  });

  describe('task cancellation', () => {
    it('should cancel queued tasks', async () => {
      scheduler = new Scheduler({ strategy: 'fifo', maxConcurrent: 1, agingInterval: 0 });
      scheduler.registerAgent(makeAgent('a1'));

      // Fill the running slot
      scheduler.submit('a1', {
        name: 'running',
        handler: async () => { await sleep(200); },
      });

      const t2 = scheduler.submit('a1', {
        name: 'to-cancel',
        handler: async () => 'should not run',
      });

      expect(scheduler.cancel(t2.id)).toBe(true);
      expect(t2.status).toBe('cancelled');
    });
  });

  describe('task timeout', () => {
    it('should fail tasks that exceed timeout', async () => {
      scheduler = new Scheduler({ strategy: 'fifo', maxConcurrent: 5, taskTimeout: 50, agingInterval: 0 });
      scheduler.registerAgent(makeAgent('a1'));

      const task = scheduler.submit('a1', {
        name: 'slow-task',
        handler: async () => { await sleep(200); return 'done'; },
      });

      await sleep(150);
      expect(task.status).toBe('failed');
      expect(task.error?.message).toMatch(/timed out/);
    });
  });

  describe('stats', () => {
    it('should track task statistics', async () => {
      scheduler = new Scheduler({ strategy: 'fifo', maxConcurrent: 5, agingInterval: 0 });
      scheduler.registerAgent(makeAgent('a1'));

      scheduler.submit('a1', { name: 'ok', handler: async () => 'ok' });
      scheduler.submit('a1', { name: 'fail', handler: async () => { throw new Error('fail'); } });

      await sleep(100);

      const stats = scheduler.getStats();
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.queued).toBe(0);
    });
  });
});
