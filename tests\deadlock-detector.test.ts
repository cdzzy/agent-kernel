import { describe, it, expect, beforeEach } from 'vitest';
import { DeadlockDetector } from '../src/deadlock-detector.js';
import { ResourceManager } from '../src/resource-manager.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DeadlockDetector', () => {
  let rm: ResourceManager;

  beforeEach(() => {
    rm = new ResourceManager({
      'res-A': { type: 'mutex' },
      'res-B': { type: 'mutex' },
      'res-C': { type: 'mutex' },
    });
  });

  it('should detect a simple two-agent deadlock', async () => {
    // Agent-1 holds res-A, waits for res-B
    // Agent-2 holds res-B, waits for res-A
    await rm.acquire('agent-1', 'res-A');
    await rm.acquire('agent-2', 'res-B');

    // Now create the circular wait (don't await — they'll block)
    rm.acquire('agent-1', 'res-B'); // agent-1 waits for res-B (held by agent-2)
    rm.acquire('agent-2', 'res-A'); // agent-2 waits for res-A (held by agent-1)

    await sleep(10);

    const detector = new DeadlockDetector(rm, { enabled: true, interval: 100, resolution: 'notify-only' });
    const cycles = detector.detect();

    expect(cycles.length).toBeGreaterThan(0);
    // The cycle should contain both agents
    const agents = cycles[0].agents;
    expect(agents).toContain('agent-1');
    expect(agents).toContain('agent-2');
  });

  it('should not report false positives', async () => {
    // Agent-1 holds res-A, agent-2 waits for res-A
    // No cycle — just linear waiting
    await rm.acquire('agent-1', 'res-A');
    rm.acquire('agent-2', 'res-A'); // waits, no cycle

    await sleep(10);

    const detector = new DeadlockDetector(rm, { enabled: true, interval: 100, resolution: 'notify-only' });
    const cycles = detector.detect();

    expect(cycles).toHaveLength(0);
  });

  it('should detect three-agent deadlock cycle', async () => {
    // A holds res-A, waits for res-B
    // B holds res-B, waits for res-C
    // C holds res-C, waits for res-A
    await rm.acquire('A', 'res-A');
    await rm.acquire('B', 'res-B');
    await rm.acquire('C', 'res-C');

    rm.acquire('A', 'res-B');
    rm.acquire('B', 'res-C');
    rm.acquire('C', 'res-A');

    await sleep(10);

    const detector = new DeadlockDetector(rm, { enabled: true, interval: 100, resolution: 'notify-only' });
    const cycles = detector.detect();

    expect(cycles.length).toBeGreaterThan(0);
  });

  it('should resolve deadlock by aborting lowest priority', async () => {
    await rm.acquire('high-agent', 'res-A');
    await rm.acquire('low-agent', 'res-B');

    // These will block and later be rejected by deadlock resolution — catch them
    const p1 = rm.acquire('high-agent', 'res-B').catch(() => {});
    const p2 = rm.acquire('low-agent', 'res-A').catch(() => {});

    await sleep(10);

    const resolved: string[] = [];
    const detector = new DeadlockDetector(rm, {
      enabled: true,
      interval: 100,
      resolution: 'abort-lowest',
    });

    detector.setAgentInfo('high-agent', 75);
    detector.setAgentInfo('low-agent', 25);
    detector.setResolveCallback((agentId) => {
      resolved.push(agentId);
    });

    detector.detect();
    await Promise.all([p1, p2]);

    expect(resolved).toContain('low-agent');
    expect(detector.getStats().resolved).toBeGreaterThan(0);
  });

  it('should track detection stats', async () => {
    const detector = new DeadlockDetector(rm, { enabled: true, interval: 100, resolution: 'notify-only' });

    // No deadlock
    detector.detect();
    expect(detector.getStats().detected).toBe(0);
  });
});
