import { describe, it, expect, afterEach } from 'vitest';
import { AgentKernel } from '../src/kernel.js';
import type { DeadlockCycle } from '../src/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AgentKernel', () => {
  let kernel: AgentKernel;

  afterEach(() => {
    kernel?.shutdown();
  });

  describe('agent lifecycle', () => {
    it('should register and list agents', () => {
      kernel = new AgentKernel();
      kernel.register('agent-1', { priority: 'high' });
      kernel.register('agent-2', { priority: 'low' });

      const agents = kernel.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.id)).toContain('agent-1');
    });

    it('should throw on duplicate registration', () => {
      kernel = new AgentKernel();
      kernel.register('agent-1');
      expect(() => kernel.register('agent-1')).toThrow(/already registered/);
    });

    it('should terminate agents', () => {
      kernel = new AgentKernel();
      kernel.register('agent-1');
      kernel.terminate('agent-1');
      expect(kernel.getAgent('agent-1')).toBeNull();
    });

    it('should track agent status changes', () => {
      kernel = new AgentKernel();
      const changes: [string, string, string][] = [];
      kernel.on('agent:status-changed', (id, old, now) => {
        changes.push([id, old, now]);
      });

      kernel.register('agent-1');
      expect(kernel.getAgentStatus('agent-1')).toBe('idle');
    });
  });

  describe('agent status lifecycle', () => {
    it('should return to idle after the last task settles', async () => {
      kernel = new AgentKernel({ scheduler: { strategy: 'fifo', maxConcurrent: 5 } });
      kernel.register('worker');

      expect(kernel.getAgentStatus('worker')).toBe('idle');

      kernel.submit('worker', { name: 't1', handler: async () => 1 });
      expect(kernel.getAgentStatus('worker')).toBe('running');

      await sleep(30);
      expect(kernel.getAgentStatus('worker')).toBe('idle');
      expect(kernel.getMetrics().agents.idle).toBe(1);
      expect(kernel.getMetrics().agents.running).toBe(0);
    });

    it('should stay running while another task is in flight', async () => {
      kernel = new AgentKernel({ scheduler: { strategy: 'fifo', maxConcurrent: 5 } });
      kernel.register('worker');

      let releaseFirst: () => void = () => {};
      const gate = new Promise<void>((r) => { releaseFirst = r; });
      kernel.submit('worker', { name: 'slow', handler: async () => { await gate; return 'a'; } });
      kernel.submit('worker', { name: 'fast', handler: async () => 'b' });

      await sleep(20);
      // fast settled; slow still running, so the agent must stay 'running'
      expect(kernel.getAgentStatus('worker')).toBe('running');

      releaseFirst();
      await sleep(20);
      expect(kernel.getAgentStatus('worker')).toBe('idle');
    });

    it('should return to idle when the last resource handle is released', async () => {
      kernel = new AgentKernel({ resources: { 'db': { type: 'mutex' } } });
      kernel.register('worker');

      const handle = await kernel.acquire('worker', 'db');
      expect(kernel.getAgentStatus('worker')).toBe('running');

      kernel.release(handle);
      expect(kernel.getAgentStatus('worker')).toBe('idle');
    });
  });

  describe('task execution', () => {
    it('should submit and execute tasks', async () => {
      kernel = new AgentKernel({
        scheduler: { strategy: 'fifo', maxConcurrent: 5 },
      });
      kernel.register('agent-1');

      const task = kernel.submit('agent-1', {
        name: 'test-task',
        handler: async () => 42,
      });

      await sleep(50);
      expect(task.status).toBe('completed');
      expect(task.result).toBe(42);
    });

    it('should reject task from unregistered agent', () => {
      kernel = new AgentKernel();
      expect(() => kernel.submit('ghost', {
        name: 'x',
        handler: async () => {},
      })).toThrow(/not registered/);
    });
  });

  describe('resource management', () => {
    it('should acquire and release resources', async () => {
      kernel = new AgentKernel({
        resources: { 'db': { type: 'mutex' } },
      });
      kernel.register('agent-1');

      const handle = await kernel.acquire('agent-1', 'db');
      expect(handle.resourceId).toBe('db');

      kernel.release(handle);
    });

    it('should support withResource pattern', async () => {
      kernel = new AgentKernel({
        resources: { 'db': { type: 'mutex' } },
      });
      kernel.register('agent-1');

      const result = await kernel.withResource('agent-1', 'db', async () => {
        return 'inside-lock';
      });

      expect(result).toBe('inside-lock');
    });

    it('should register resources dynamically', async () => {
      kernel = new AgentKernel();
      kernel.register('agent-1');

      kernel.registerResource('new-res', { type: 'mutex' });
      const handle = await kernel.acquire('agent-1', 'new-res');
      expect(handle.resourceId).toBe('new-res');
      kernel.release(handle);
    });
  });

  describe('messaging', () => {
    it('should send direct messages between agents', async () => {
      kernel = new AgentKernel();
      kernel.register('sender');
      kernel.register('receiver');

      const received: unknown[] = [];
      kernel.onMessage('receiver', async (msg) => {
        received.push(msg.payload);
      });

      await kernel.send('sender', 'receiver', { hello: 'world' });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ hello: 'world' });
    });

    it('should support pub/sub topics', async () => {
      kernel = new AgentKernel();
      kernel.register('publisher');
      kernel.register('sub-1');
      kernel.register('sub-2');

      const sub1Msgs: unknown[] = [];
      const sub2Msgs: unknown[] = [];

      kernel.subscribe('sub-1', 'news', async (msg) => { sub1Msgs.push(msg.payload); });
      kernel.subscribe('sub-2', 'news', async (msg) => { sub2Msgs.push(msg.payload); });

      await kernel.publish('publisher', 'news', 'breaking news');

      expect(sub1Msgs).toEqual(['breaking news']);
      expect(sub2Msgs).toEqual(['breaking news']);
    });
  });

  describe('metrics', () => {
    it('should return kernel metrics', async () => {
      kernel = new AgentKernel({
        resources: {
          'llm': { type: 'pool', capacity: 3 },
        },
        scheduler: { strategy: 'priority', maxConcurrent: 5 },
      });
      kernel.register('a1', { priority: 'high' });
      kernel.register('a2', { priority: 'low' });

      kernel.submit('a1', { name: 't1', handler: async () => 'ok' });
      await sleep(50);

      const metrics = kernel.getMetrics();
      expect(metrics.agents.total).toBe(2);
      expect(metrics.tasks.completed).toBe(1);
      expect(metrics.resources['llm']).toBeDefined();
    });
  });

  describe('events', () => {
    it('should emit task lifecycle events', async () => {
      kernel = new AgentKernel({
        scheduler: { strategy: 'fifo', maxConcurrent: 5 },
      });
      kernel.register('a1');

      const events: string[] = [];
      kernel.on('task:submitted', () => events.push('submitted'));
      kernel.on('task:started', () => events.push('started'));
      kernel.on('task:completed', () => events.push('completed'));

      kernel.submit('a1', {
        name: 'tracked',
        handler: async () => 'done',
      });

      await sleep(50);
      expect(events).toEqual(['submitted', 'started', 'completed']);
    });

    it('should emit resource events', async () => {
      kernel = new AgentKernel({
        resources: { 'r': { type: 'mutex' } },
      });
      kernel.register('a1');

      const events: string[] = [];
      kernel.on('resource:acquired', () => events.push('acquired'));
      kernel.on('resource:released', () => events.push('released'));

      const h = await kernel.acquire('a1', 'r');
      kernel.release(h);

      expect(events).toEqual(['acquired', 'released']);
    });
  });

  describe('full pipeline', () => {
    it('should run a multi-agent pipeline with dependencies', async () => {
      kernel = new AgentKernel({
        scheduler: { strategy: 'priority', maxConcurrent: 5 },
        resources: {
          'llm': { type: 'pool', capacity: 2 },
        },
      });

      kernel.register('researcher', { priority: 'high' });
      kernel.register('writer', { priority: 'medium' });
      kernel.start();

      const order: string[] = [];

      const t1 = kernel.submit('researcher', {
        name: 'research',
        handler: async () => { order.push('research'); return { data: 'findings' }; },
      });

      const t2 = kernel.submit('writer', {
        name: 'write',
        dependencies: [t1.id],
        handler: async () => { order.push('write'); return { doc: 'report' }; },
      });

      await sleep(200);

      expect(order).toEqual(['research', 'write']);
      expect(t1.status).toBe('completed');
      expect(t2.status).toBe('completed');
    });
  });
});
