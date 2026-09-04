/**
 * Tests for the TraceShield audit bridge (v0.5.0).
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentKernel } from '../src/kernel.js';
import { attachTraceShield, type ShieldRecorderLike, type ShieldViolation } from '../src/integrations/traceshield.js';

class MockRecorder implements ShieldRecorderLike {
  traces = new Map<string, { agentId: string; status: string; sessionId?: string }>();
  spans = new Map<string, { traceId: string; name: string; status: string; output?: unknown; error?: { message: string } }>();
  violations: ShieldViolation[] = [];
  private n = 0;

  async startTrace(agentId: string, options?: { sessionId?: string }) {
    const id = `trace-${++this.n}`;
    this.traces.set(id, { agentId, status: 'running', sessionId: options?.sessionId });
    return { id };
  }

  startSpan(traceId: string, actionType: string, name: string) {
    const id = `span-${++this.n}`;
    this.spans.set(id, { traceId, name, status: 'running', actionType });
    return { id };
  }

  async endSpan(traceId: string, spanId: string, result: { output?: unknown; status: 'completed' | 'failed'; error?: { message: string } }) {
    const span = this.spans.get(spanId)!;
    span.status = result.status;
    span.output = result.output;
    span.error = result.error;
    return span;
  }

  async endTrace(traceId: string, status: 'completed' | 'failed' | 'aborted') {
    const trace = this.traces.get(traceId)!;
    trace.status = status;
    return trace;
  }

  async saveViolation(v: ShieldViolation) {
    this.violations.push(v);
  }
}

function makeKernelWithWork(): { kernel: AgentKernel; recorder: MockRecorder } {
  const kernel = new AgentKernel();
  const recorder = new MockRecorder();
  attachTraceShield(kernel, recorder, {
    sessionId: 'test-session',
    violations: { deadlocks: true, budgets: true, health: true, taskFailures: true },
  });
  kernel.register('worker-1');
  kernel.register('worker-2');
  kernel.start();
  return { kernel, recorder };
}

describe('attachTraceShield', () => {
  it('audits a completed task lifecycle', async () => {
    const { kernel, recorder } = makeKernelWithWork();

    kernel.submit('worker-1', { name: 'greet', handler: async () => 'hello' });
    await vi.waitFor(() => {
      expect(recorder.traces.size).toBe(1);
      expect(recorder.spans.size).toBe(1);
    });

    const trace = [...recorder.traces.values()][0]!;
    expect(trace.agentId).toBe('worker-1');
    expect(trace.status).toBe('completed');
    expect(trace.sessionId).toBe('test-session');

    const span = [...recorder.spans.values()][0]!;
    expect(span.name).toBe('greet');
    expect(span.status).toBe('completed');
    expect(span.output).toBe('hello');
  });

  it('audits a failed task with error details', async () => {
    const { kernel, recorder } = makeKernelWithWork();

    kernel.submit('worker-1', {
      name: 'boom',
      handler: async () => {
        throw new Error('exploded');
      },
    });
    await vi.waitFor(() => {
      expect(recorder.traces.size).toBe(1);
    });

    const trace = [...recorder.traces.values()][0]!;
    expect(trace.status).toBe('failed');

    const span = [...recorder.spans.values()][0]!;
    expect(span.status).toBe('failed');
    expect(span.error?.message).toBe('exploded');

    await vi.waitFor(() => {
      expect(recorder.violations.some((v) => v.rule_id === 'task-failed')).toBe(true);
    });
  });

  it('records deadlock violations when enabled', async () => {
    const { kernel, recorder } = makeKernelWithWork();

    kernel.emit('deadlock:detected', { agents: ['a', 'b'], resources: ['r1', 'r2'], detectedAt: Date.now() });

    await vi.waitFor(() => {
      expect(recorder.violations.length).toBe(1);
    });
    const v = recorder.violations[0]!;
    expect(v.rule_id).toBe('deadlock-cycle');
    expect(v.effect).toBe('deny');
    expect(v.message).toContain('a, b');
  });

  it('records budget violations with the resource name', async () => {
    const { kernel, recorder } = makeKernelWithWork();

    kernel.emit('budget-exceeded', 'worker-1', 'maxTokens', 15000);

    await vi.waitFor(() => {
      expect(recorder.violations.length).toBe(1);
    });
    expect(recorder.violations[0]!.rule_id).toBe('budget-exceeded:maxTokens');
    expect(recorder.violations[0]!.agent_id).toBe('worker-1');
  });

  it('records health.critical violations with reason', async () => {
    const { kernel, recorder } = makeKernelWithWork();

    kernel.emit('health.critical', 'worker-2', { status: 'unhealthy', reason: 'queue backlog' });

    await vi.waitFor(() => {
      expect(recorder.violations.length).toBe(1);
    });
    expect(recorder.violations[0]!.rule_id).toBe('health-critical');
    expect(recorder.violations[0]!.message).toContain('queue backlog');
  });

  it('detach stops all recording', async () => {
    const kernel = new AgentKernel();
    const recorder = new MockRecorder();
    const binding = attachTraceShield(kernel, recorder);
    binding.detach();

    kernel.register('worker-1');
    kernel.start();
    await kernel.submit('worker-1', { name: 'unaudited', handler: async () => 'x' }).handler();
    await new Promise((r) => setTimeout(r, 30));

    expect(recorder.traces.size).toBe(0);
    expect(recorder.spans.size).toBe(0);
  });

  it('violations are opt-in (off by default)', async () => {
    const kernel = new AgentKernel();
    const recorder = new MockRecorder();
    attachTraceShield(kernel, recorder); // no violations config

    kernel.emit('budget-exceeded', 'worker-1', 'maxTokens', 999);
    await new Promise((r) => setTimeout(r, 20));

    expect(recorder.violations.length).toBe(0);
  });

  it('audits concurrent tasks into separate traces', async () => {
    const { kernel, recorder } = makeKernelWithWork();

    const t1 = kernel.submit('worker-1', { name: 'task-1', handler: async () => 'r1' });
    const t2 = kernel.submit('worker-2', { name: 'task-2', handler: async () => 'r2' });
    

    await vi.waitFor(() => {
      expect(recorder.traces.size).toBe(2);
    });
    const statuses = [...recorder.traces.values()].map((t) => t.status).sort();
    expect(statuses).toEqual(['completed', 'completed']);
  });
});
