import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceManager } from '../src/resource-manager.js';

describe('ResourceManager', () => {
  let rm: ResourceManager;

  beforeEach(() => {
    rm = new ResourceManager({
      'db': { type: 'mutex' },
      'llm': { type: 'pool', capacity: 2 },
      'api': { type: 'semaphore', permits: 3 },
    });
  });

  describe('mutex resource', () => {
    it('should allow exclusive access', async () => {
      const h1 = await rm.acquire('agent-1', 'db');
      expect(h1.resourceId).toBe('db');
      expect(h1.agentId).toBe('agent-1');

      rm.release(h1);
    });

    it('should queue second requester', async () => {
      const h1 = await rm.acquire('agent-1', 'db');

      let agent2Got = false;
      const p2 = rm.acquire('agent-2', 'db').then((h) => { agent2Got = true; return h; });

      expect(agent2Got).toBe(false);
      rm.release(h1);
      const h2 = await p2;
      expect(agent2Got).toBe(true);
      rm.release(h2);
    });
  });

  describe('pool resource', () => {
    it('should allow up to capacity concurrent holders', async () => {
      const h1 = await rm.acquire('a1', 'llm');
      const h2 = await rm.acquire('a2', 'llm');

      const info = rm.getResourceInfo('llm');
      expect(info?.owners).toHaveLength(2);

      let a3Got = false;
      const p3 = rm.acquire('a3', 'llm').then((h) => { a3Got = true; return h; });
      expect(a3Got).toBe(false);

      rm.release(h1);
      await p3;
      expect(a3Got).toBe(true);

      rm.release(h2);
    });
  });

  describe('withResource', () => {
    it('should auto-release after handler completes', async () => {
      const result = await rm.withResource('agent-1', 'db', async () => {
        const info = rm.getResourceInfo('db');
        expect(info?.owners).toContain('agent-1');
        return 42;
      });

      expect(result).toBe(42);
      const info = rm.getResourceInfo('db');
      expect(info?.owners).toHaveLength(0);
    });

    it('should auto-release on handler error', async () => {
      await expect(
        rm.withResource('agent-1', 'db', async () => { throw new Error('boom'); }),
      ).rejects.toThrow('boom');

      const info = rm.getResourceInfo('db');
      expect(info?.owners).toHaveLength(0);
    });
  });

  describe('wait graph', () => {
    it('should build wait graph from blocked agents', async () => {
      await rm.acquire('agent-1', 'db');
      // agent-2 will be waiting
      rm.acquire('agent-2', 'db'); // don't await

      // Give microtask a tick
      await new Promise((r) => setTimeout(r, 10));

      const graph = rm.getWaitGraph();
      expect(graph.has('agent-2')).toBe(true);
      expect(graph.get('agent-2')?.waitingFor).toBe('db');
      expect(graph.get('agent-2')?.heldBy).toContain('agent-1');
    });
  });

  describe('releaseAll', () => {
    it('should release all resources held by agent', async () => {
      const h1 = await rm.acquire('agent-1', 'db');
      const h2 = await rm.acquire('agent-1', 'llm');

      rm.releaseAll('agent-1');

      const dbInfo = rm.getResourceInfo('db');
      const llmInfo = rm.getResourceInfo('llm');
      expect(dbInfo?.owners).toHaveLength(0);
      expect(llmInfo?.owners).toHaveLength(0);
    });
  });

  it('should throw for unknown resource', async () => {
    await expect(rm.acquire('agent-1', 'nonexistent')).rejects.toThrow(/not found/);
  });

  it('should support timeout', async () => {
    await rm.acquire('agent-1', 'db');
    await expect(rm.acquire('agent-2', 'db', 50)).rejects.toThrow(/timeout/);
  });
});
