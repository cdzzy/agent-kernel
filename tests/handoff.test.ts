import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentKernel } from '../src/index.js';
import {
  HandoffCoordinator,
  HandoffSignal,
  HandoffExecutionError,
} from '../src/handoff.js';

function makeKernel(): AgentKernel {
  const kernel = new AgentKernel();
  for (const id of ['a', 'b', 'c', 'd', 'w1', 'w2']) {
    kernel.register(id);
  }
  return kernel;
}

async function captureError<T>(
  promise: Promise<T>,
): Promise<{ error: HandoffExecutionError | Error; result?: unknown }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HandoffExecutionError) {
      return { error: err, result: err.result };
    }
    return { error: err as Error };
  }
  throw new Error('expected execute() to reject');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HandoffCoordinator — plain execution', () => {
  it('completes without any handoff', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => 42);

    const result = await handoff.execute('a', { taskName: 't', payload: 'in' });

    expect(result.status).toBe('completed');
    expect(result.output).toBe(42);
    expect(result.chain).toEqual([]);
    expect(result.finalAgent).toBe('a');
    expect(result.origin).toBe('a');
    expect(result.depth).toBe(1);
  });

  it('rejects when the origin is not registered in the kernel', async () => {
    const kernel = new AgentKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('ghost', () => 1);

    await expect(handoff.execute('ghost', { taskName: 't' })).rejects.toThrow(
      'not registered in the kernel',
    );
  });

  it('rejects when no handler is registered for the origin', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    const { result } = await captureError(
      handoff.execute('a', { taskName: 't' }),
    );
    expect((result as { status: string }).status).toBe('failed');
  });

  it('each hop runs through the kernel scheduler', async () => {
    const kernel = makeKernel();
    const submitted = vi.fn();
    kernel.on('task:submitted', submitted);

    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('b');
    });
    handoff.register('b', () => 'done');

    const result = await handoff.execute('a', { taskName: 't' });

    expect(submitted).toHaveBeenCalledTimes(2);
    expect(result.output).toBe('done');
    expect(result.depth).toBe(2);
  });
});

describe('HandoffCoordinator — transfer mode', () => {
  it('moves control to the target and ends there', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('b', { reason: 'b is better at this' });
    });
    handoff.register('b', (ctx) => `b received ${String(ctx.payload)}`);

    const result = await handoff.execute('a', { taskName: 't', payload: 'p1' });

    expect(result.output).toBe('b received p1');
    expect(result.finalAgent).toBe('b');
    expect(result.depth).toBe(2);
    expect(result.chain).toHaveLength(1);
    expect(result.chain[0]).toMatchObject({
      from: 'a',
      to: 'b',
      mode: 'transfer',
      reason: 'b is better at this',
    });
  });

  it('chains multiple transfers with payload replacement', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('b', { payload: { step: 1 } });
    });
    handoff.register('b', (ctx) => {
      throw new HandoffSignal('c', { payload: { step: (ctx.payload as { step: number }).step + 1 } });
    });
    handoff.register('c', (ctx) => ctx.payload);

    const result = await handoff.execute('a', { taskName: 't', payload: { step: 0 } });

    expect(result.output).toEqual({ step: 2 });
    expect(result.finalAgent).toBe('c');
    expect(result.depth).toBe(3);
    expect(result.chain.map((r) => `${r.from}->${r.to}`)).toEqual(['a->b', 'b->c']);
  });

  it('keeps the payload when the signal omits it', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('b');
    });
    handoff.register('b', (ctx) => ctx.payload);

    const result = await handoff.execute('a', { taskName: 't', payload: 'carried' });

    expect(result.output).toBe('carried');
  });

  it('detects transfer cycles and fails fast', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('b');
    });
    handoff.register('b', () => {
      throw new HandoffSignal('a');
    });

    const handoffEvents: string[] = [];
    handoff.on('handoff', (record: { from: string; to: string }) => {
      handoffEvents.push(`${record.from}->${record.to}`);
    });

    const { error, result } = await captureError(
      handoff.execute('a', { taskName: 't' }),
    );

    expect(error).toBeInstanceOf(HandoffExecutionError);
    expect(error.message).toContain('cycle');
    expect((result as { status: string }).status).toBe('cycle');
    expect((result as { chain: unknown[] }).chain).toHaveLength(1); // a->b only
    expect(handoffEvents).toEqual(['a->b']);
    expect(handoff.getStats().cyclesDetected).toBe(1);
  });

  it('rejects unknown targets', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('nobody');
    });

    const { error, result } = await captureError(
      handoff.execute('a', { taskName: 't' }),
    );

    expect(error.message).toContain('nobody');
    expect((result as { status: string }).status).toBe('failed');
  });
});

describe('HandoffCoordinator — delegate mode', () => {
  it('returns the result to the delegating agent', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    const aPayloads: unknown[] = [];
    handoff.register('a', (ctx) => {
      aPayloads.push(ctx.payload);
      if (aPayloads.length === 1) {
        throw new HandoffSignal('b', { mode: 'delegate', reason: 'need b' });
      }
      return `final:${JSON.stringify(ctx.payload)}`;
    });
    handoff.register('b', () => 42);

    const result = await handoff.execute('a', { taskName: 't', payload: 'start' });

    expect(aPayloads).toEqual(['start', 42]); // second run sees b's output
    expect(result.output).toBe('final:42');
    expect(result.finalAgent).toBe('a');
    expect(result.depth).toBe(3); // a, b, a(resume)
    expect(result.chain).toEqual([
      { from: 'a', to: 'b', mode: 'delegate', reason: 'need b', at: expect.any(Number) },
      { from: 'b', to: 'a', mode: 'delegate', reason: 'delegate-return', at: expect.any(Number) },
    ]);
  });

  it('unwinds nested delegates in stack order', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    const calls: string[] = [];
    let aRuns = 0;
    let bRuns = 0;
    handoff.register('a', (ctx) => {
      aRuns++;
      calls.push(`a:${String(ctx.payload)}`);
      if (aRuns === 1) {
        throw new HandoffSignal('b', { mode: 'delegate' });
      }
      return `a(${String(ctx.payload)})`;
    });
    handoff.register('b', (ctx) => {
      bRuns++;
      calls.push(`b:${String(ctx.payload)}`);
      if (bRuns === 1) {
        throw new HandoffSignal('c', { mode: 'delegate' });
      }
      return String(ctx.payload); // pass the delegate result through
    });
    handoff.register('c', () => {
      calls.push('c');
      return 1;
    });

    const result = await handoff.execute('a', { taskName: 't', payload: 'x' });

    // a delegates to b, b delegates to c, c returns 1 -> b resumes with
    // payload 1 and passes it through -> a resumes and wraps it.
    expect(calls).toEqual(['a:x', 'b:x', 'c', 'b:1', 'a:1']);
    expect(result.output).toBe('a(1)');
    expect(result.chain.map((r) => `${r.from}->${r.to}(${r.mode})`)).toEqual([
      'a->b(delegate)',
      'b->c(delegate)',
      'c->b(delegate)',
      'b->a(delegate)',
    ]);
    expect(result.depth).toBe(5);
  });

  it('allows a delegate to revisit the origin (not a transfer cycle)', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    let aRuns = 0;
    handoff.register('a', (ctx) => {
      aRuns++;
      if (aRuns === 1) {
        throw new HandoffSignal('b', { mode: 'delegate' });
      }
      return `a:${String(ctx.payload)}`;
    });
    let bRuns = 0;
    handoff.register('b', (ctx) => {
      bRuns++;
      if (bRuns === 1) {
        throw new HandoffSignal('a', { mode: 'delegate', payload: 'from-b' });
      }
      return `b:${String(ctx.payload)}`;
    });

    const result = await handoff.execute('a', { taskName: 't' });

    // a delegates to b; b delegates back to a (legal — not a transfer cycle);
    // then the stack unwinds: a -> b -> a.
    expect(result.status).toBe('completed');
    expect(result.output).toBe('a:b:a:from-b');
    expect(result.depth).toBe(5);
    expect(result.chain.map((r) => `${r.from}->${r.to}`)).toEqual([
      'a->b', 'b->a', 'a->b', 'b->a',
    ]);
    expect(handoff.getStats().cyclesDetected).toBe(0);
  });

  it('mixes transfer and delegate in one chain (tail-call semantics)', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    let aRuns = 0;
    handoff.register('a', (ctx) => {
      aRuns++;
      if (aRuns === 1) {
        throw new HandoffSignal('b', { mode: 'delegate' });
      }
      return `a-final:${String(ctx.payload)}`;
    });
    handoff.register('b', () => {
      throw new HandoffSignal('c'); // plain transfer: b exits the chain
    });
    handoff.register('c', () => 'c-result');

    const result = await handoff.execute('a', { taskName: 't' });

    // a delegates to b; b tail-transfers to c; c's return unwinds to a.
    expect(result.output).toBe('a-final:c-result');
    expect(result.finalAgent).toBe('a');
    expect(result.depth).toBe(4);
    expect(result.chain.map((r) => `${r.from}->${r.to}(${r.mode})`)).toEqual([
      'a->b(delegate)',
      'b->c(transfer)',
      'c->a(delegate)',
    ]);
  });
});

describe('HandoffCoordinator — capability routing', () => {
  it('routes by capability to the least-busy agent', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    let releaseW1!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseW1 = resolve;
    });

    handoff.register('a', () => {
      throw new HandoffSignal('write');
    });
    handoff.register('w1', async () => {
      await gate;
      return 'w1';
    }, ['write']);
    handoff.register('w2', () => 'w2', ['write']);

    // Chain 1 lands on w1 (first registered, both idle) and blocks there.
    const chain1 = handoff.execute('a', { taskName: 't1' });
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Chain 2 should now route around the busy w1.
    const chain2 = await handoff.execute('a', { taskName: 't2' });
    expect(chain2.output).toBe('w2');
    expect(chain2.finalAgent).toBe('w2');

    releaseW1();
    const result1 = await chain1;
    expect(result1.output).toBe('w1');
    expect(result1.finalAgent).toBe('w1');
  });

  it('an exact agent id takes precedence over a capability of the same name', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    // Agent literally named "write" plus another agent advertising capability "write".
    kernel.register('write');
    handoff.register('a', () => {
      throw new HandoffSignal('write');
    });
    handoff.register('write', () => 'direct-agent');
    handoff.register('w2', () => 'capability-agent', ['write']);

    const result = await handoff.execute('a', { taskName: 't' });

    expect(result.finalAgent).toBe('write');
    expect(result.output).toBe('direct-agent');
  });

  it('skips capability candidates the kernel does not know', async () => {
    const kernel = new AgentKernel(); // only 'a' will be registered
    kernel.register('a');
    const handoff = new HandoffCoordinator(kernel);

    handoff.register('a', () => {
      throw new HandoffSignal('write');
    });
    // ghost advertises write but is not registered in the kernel
    handoff.register('ghost', () => 'ghost', ['write']);
    handoff.register('known', () => 'known', ['write']);
    kernel.register('known');

    const result = await handoff.execute('a', { taskName: 't' });

    expect(result.finalAgent).toBe('known');
    expect(result.output).toBe('known');
  });
});

describe('HandoffCoordinator — failure modes', () => {
  it('propagates a plain handler error with the chain attached', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('b');
    });
    handoff.register('b', () => {
      throw new Error('boom');
    });

    const { error, result } = await captureError(
      handoff.execute('a', { taskName: 't' }),
    );

    expect(error).toBeInstanceOf(HandoffExecutionError);
    expect((result as { status: string }).status).toBe('failed');
    expect((result as { error: Error }).error.message).toBe('boom');
    expect((result as { chain: { to: string }[] }).chain).toEqual([
      expect.objectContaining({ to: 'b' }),
    ]);
  });

  it('stops runaway chains at maxChainDepth', async () => {
    const kernel = new AgentKernel();
    for (let i = 0; i < 6; i++) kernel.register(`a${i}`);
    const handoff = new HandoffCoordinator(kernel, { maxChainDepth: 3 });

    for (let i = 0; i < 5; i++) {
      handoff.register(`a${i}`, () => {
        throw new HandoffSignal(`a${i + 1}`);
      });
    }
    handoff.register('a5', () => 'end');

    const { error, result } = await captureError(
      handoff.execute('a0', { taskName: 't' }),
    );

    expect(error.message).toContain('maxChainDepth');
    expect((result as { status: string }).status).toBe('max-depth');
    expect((result as { chain: unknown[] }).chain).toHaveLength(2); // a0->a1->a2, capped
  });

  it('times out a slow chain and reports the status', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => new Promise((resolve) => setTimeout(resolve, 300)));

    const { error, result } = await captureError(
      handoff.execute('a', { taskName: 't', timeoutMs: 50 }),
    );

    expect(error.message).toContain('timed out');
    expect((result as { status: string }).status).toBe('timeout');
  });

  it('unregistered agents can no longer receive handoffs', async () => {
    const kernel = new AgentKernel();
    kernel.register('a');
    const handoff = new HandoffCoordinator(kernel);
    handoff.register('a', () => {
      throw new HandoffSignal('b');
    });
    handoff.register('b', () => 'b');
    handoff.unregister('b');

    const { result } = await captureError(handoff.execute('a', { taskName: 't' }));
    expect((result as { status: string }).status).toBe('failed');
  });
});

describe('HandoffCoordinator — events and stats', () => {
  it('emits handoff/completed/failed events', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    const events: string[] = [];
    handoff.on('handoff', (record: { from: string; to: string }) => {
      events.push(`hop:${record.from}->${record.to}`);
    });
    handoff.on('completed', (result: { status: string }) => {
      events.push(`completed:${result.status}`);
    });
    handoff.on('failed', (result: { status: string }) => {
      events.push(`failed:${result.status}`);
    });

    handoff.register('a', () => {
      throw new HandoffSignal('b');
    });
    handoff.register('b', () => 'ok');

    await handoff.execute('a', { taskName: 't' });

    handoff.register('c', () => {
      throw new HandoffSignal('nobody');
    });
    await captureError(handoff.execute('c', { taskName: 't2' }));

    expect(events).toEqual(['hop:a->b', 'completed:completed', 'failed:failed']);
  });

  it('tracks stats across chains', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    handoff.register('a', () => {
      throw new HandoffSignal('b');
    });
    handoff.register('b', () => 'ok');

    await handoff.execute('a', { taskName: 't1' });
    await handoff.execute('a', { taskName: 't2' });

    expect(handoff.getStats()).toEqual({
      totalHandoffs: 2,
      chainsCompleted: 2,
      chainsFailed: 0,
      cyclesDetected: 0,
    });
  });

  it('runs concurrent chains independently', async () => {
    const kernel = makeKernel();
    const handoff = new HandoffCoordinator(kernel);

    handoff.register('a', (ctx) => {
      throw new HandoffSignal('b', { payload: ctx.payload });
    });
    handoff.register('b', (ctx) => `b:${String(ctx.payload)}`);

    const [r1, r2] = await Promise.all([
      handoff.execute('a', { taskName: 't1', payload: 'p1', metadata: { name: 'n1' } }),
      handoff.execute('a', { taskName: 't2', payload: 'p2', metadata: { name: 'n2' } }),
    ]);

    expect(r1.output).toBe('b:p1');
    expect(r2.output).toBe('b:p2');
    expect(r1.chain).toHaveLength(1);
    expect(r2.chain).toHaveLength(1);
  });
});
