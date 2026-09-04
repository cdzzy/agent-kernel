/**
 * TraceShield integration — audit every kernel task automatically.
 *
 * Bridges AgentKernel lifecycle events into a TraceShield-compatible
 * TraceRecorder, so scheduling decisions, task outcomes, deadlocks, budget
 * violations, and health alarms land in the tamper-evident audit trail.
 *
 * The recorder is duck-typed (no hard dependency): any object matching the
 * interface below works — including traceshield's `TraceRecorder` and any
 * custom backend implementing the same surface.
 *
 * Mapping:
 *   task:started   → startTrace + startSpan(action_type="task")
 *   task:completed → endSpan(completed) + endTrace(completed)
 *   task:failed    → endSpan(failed, error) + endTrace(failed) [+ violation]
 *   deadlock:detected / budget-exceeded / health.critical → StoredViolation
 *
 * Usage::
 *   import { AgentKernel } from 'agent-kernel';
 *   import { TraceRecorder } from 'traceshield';
 *   import { attachTraceShield } from 'agent-kernel/integrations/traceshield';
 *
 *   const kernel = new AgentKernel();
 *   const recorder = new TraceRecorder({ storage: new MemoryStorage() });
 *   const binding = attachTraceShield(kernel, recorder, {
 *     sessionId: 'fleet-prod-1',
 *     violations: { deadlocks: true, budgets: true, health: true },
 *   });
 *   // ... later: binding.detach();
 */

import type { AgentKernel } from '../kernel.js';
import type { AgentId, TaskDescriptor } from '../types.js';

// ── Duck-typed TraceShield surface ────────────────────────────────────────

/** Subset of traceshield's Span error shape. */
export interface SpanErrorLike {
  type: string;
  message: string;
  stack?: string;
}

/** Minimal recorder contract (structurally satisfied by traceshield's TraceRecorder). */
export interface ShieldRecorderLike {
  startTrace(
    agentId: AgentId,
    options?: { sessionId?: string; metadata?: Record<string, unknown> },
  ): Promise<{ id: string }>;
  startSpan(
    traceId: string,
    actionType: string,
    name: string,
    input: unknown,
    options?: { parentSpanId?: string; metadata?: Record<string, unknown> },
  ): { id: string };
  endSpan(
    traceId: string,
    spanId: string,
    result: {
      output?: unknown;
      status: 'completed' | 'failed';
      error?: SpanErrorLike;
      policyEvaluations?: unknown[];
    },
  ): Promise<unknown>;
  endTrace(traceId: string, status: 'completed' | 'failed' | 'aborted'): Promise<unknown>;
  saveViolation?(violation: ShieldViolation): Promise<void>;
}

/** Synthesized violation emitted for kernel operational events. */
export interface ShieldViolation {
  id: string;
  trace_id: string;
  span_id: string;
  agent_id: AgentId;
  policy_name: string;
  rule_id: string;
  effect: 'deny' | 'warn' | 'audit';
  message?: string;
  context: {
    action_type: string;
    action_name: string;
    input: unknown;
    trace_id: string;
    span_count: number;
    elapsed_ms: number;
  };
  occurred_at: string;
}

export interface TraceShieldBridgeOptions {
  /** Session id stamped on every trace. */
  sessionId?: string;
  /** Which kernel events become StoredViolations (all default false). */
  violations?: {
    deadlocks?: boolean;
    budgets?: boolean;
    health?: boolean;
    taskFailures?: boolean;
  };
}

export interface KernelTraceBinding {
  /** Stop listening; recorded traces remain intact. */
  detach(): void;
}

let violationCounter = 0;

// ── Bridge ────────────────────────────────────────────────────────────────

export function attachTraceShield(
  kernel: AgentKernel,
  recorder: ShieldRecorderLike,
  options: TraceShieldBridgeOptions = {},
): KernelTraceBinding {
  const sessionId = options.sessionId;
  const violations = {
    deadlocks: options.violations?.deadlocks ?? false,
    budgets: options.violations?.budgets ?? false,
    health: options.violations?.health ?? false,
    taskFailures: options.violations?.taskFailures ?? false,
  };

  /** taskId → in-flight trace creation (completed/failed await this). */
  const pending = new Map<string, Promise<{ traceId: string; spanId: string }>>();
  /** taskId → resolved ids (for events arriving after completion). */
  const resolved = new Map<string, { traceId: string; spanId: string }>();

  const swallow = (what: string) => (err: unknown) => {
    // Auditing must never break the kernel — log-and-continue.
    process.stderr.write(
      `[trace-shield-bridge] failed to record ${what}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  };

  const recordViolation = (violation: Omit<ShieldViolation, 'id' | 'occurred_at'>): void => {
    if (!recorder.saveViolation) return;
    const full: ShieldViolation = {
      ...violation,
      id: `kernel-violation-${++violationCounter}`,
      occurred_at: new Date().toISOString(),
    };
    recorder.saveViolation(full).catch(swallow(`violation ${violation.rule_id}`));
  };

  const beginTaskTrace = (task: TaskDescriptor): Promise<{ traceId: string; spanId: string }> => {
    const promise = (async () => {
      const trace = await recorder.startTrace(task.agentId, {
        sessionId,
        metadata: { taskId: task.id, priority: task.priority },
      });
      const span = recorder.startSpan(trace.id, 'task', task.name, {
        resources: task.resources,
        submittedAt: task.submittedAt,
      });
      return { traceId: trace.id, spanId: span.id };
    })();
    pending.set(task.id, promise);
    promise
      .then(({ traceId, spanId }) => {
        pending.delete(task.id);
        resolved.set(task.id, { traceId, spanId });
      })
      .catch(swallow(`trace start for task ${task.name}`));
    return promise;
  };

  const onTaskStarted = (task: TaskDescriptor): void => {
    void beginTaskTrace(task);
  };

  const finishTask = (task: TaskDescriptor, failed: boolean): void => {
    const inflight = pending.get(task.id);
    const work = (async () => {
      const ids = inflight ? await inflight : resolved.get(task.id);
      if (!ids) return; // started before attach — nothing to close
      await recorder.endSpan(ids.traceId, ids.spanId, {
        output: task.result,
        status: failed ? 'failed' : 'completed',
        error: task.error
          ? { type: task.error.constructor.name, message: task.error.message, stack: task.error.stack }
          : undefined,
      });
      await recorder.endTrace(ids.traceId, failed ? 'failed' : 'completed');
      if (failed && violations.taskFailures) {
        recordViolation({
          trace_id: ids.traceId,
          span_id: ids.spanId,
          agent_id: task.agentId,
          policy_name: 'kernel',
          rule_id: 'task-failed',
          effect: 'warn',
          message: `Task "${task.name}" failed: ${task.error?.message ?? 'unknown error'}`,
          context: {
            action_type: 'task',
            action_name: task.name,
            input: null,
            trace_id: ids.traceId,
            span_count: 1,
            elapsed_ms: 0,
          },
        });
      }
    })();
    work
      .then(() => {
        resolved.delete(task.id);
        pending.delete(task.id);
      })
      .catch(swallow(`trace end for task ${task.name}`));
  };

  const onTaskCompleted = (task: TaskDescriptor): void => finishTask(task, false);
  const onTaskFailed = (task: TaskDescriptor): void => finishTask(task, true);

  const onDeadlock = (cycle: { agents: AgentId[]; resources: string[]; detectedAt: number }): void => {
    if (!violations.deadlocks) return;
    recordViolation({
      trace_id: 'kernel',
      span_id: 'kernel',
      agent_id: cycle.agents[0] ?? 'kernel',
      policy_name: 'kernel',
      rule_id: 'deadlock-cycle',
      effect: 'deny',
      message: `Deadlock detected among [${cycle.agents.join(', ')}] over [${cycle.resources.join(', ')}]`,
      context: {
        action_type: 'resource',
        action_name: 'deadlock-detection',
        input: { agents: cycle.agents, resources: cycle.resources },
        trace_id: 'kernel',
        span_count: 0,
        elapsed_ms: 0,
      },
    });
  };

  const onBudgetExceeded = (agentId: AgentId, resource: string, usage: number): void => {
    if (!violations.budgets) return;
    recordViolation({
      trace_id: 'kernel',
      span_id: 'kernel',
      agent_id: agentId,
      policy_name: 'kernel',
      rule_id: `budget-exceeded:${resource}`,
      effect: 'warn',
      message: `Agent "${agentId}" exceeded budget "${resource}" (usage: ${usage})`,
      context: {
        action_type: 'resource',
        action_name: 'budget-check',
        input: { resource, usage },
        trace_id: 'kernel',
        span_count: 0,
        elapsed_ms: 0,
      },
    });
  };

  const onHealthCritical = (agentId: AgentId, health: unknown): void => {
    if (!violations.health) return;
    const reason = (health as { reason?: string })?.reason;
    recordViolation({
      trace_id: 'kernel',
      span_id: 'kernel',
      agent_id: agentId,
      policy_name: 'kernel',
      rule_id: 'health-critical',
      effect: 'warn',
      message: `Agent "${agentId}" health critical${reason ? `: ${reason}` : ''}`,
      context: {
        action_type: 'decision',
        action_name: 'health-check',
        input: health,
        trace_id: 'kernel',
        span_count: 0,
        elapsed_ms: 0,
      },
    });
  };

  kernel.on('task:started', onTaskStarted);
  kernel.on('task:completed', onTaskCompleted);
  kernel.on('task:failed', onTaskFailed);
  kernel.on('deadlock:detected', onDeadlock);
  kernel.on('budget-exceeded', onBudgetExceeded);
  kernel.on('health.critical', onHealthCritical);

  return {
    detach(): void {
      kernel.off('task:started', onTaskStarted);
      kernel.off('task:completed', onTaskCompleted);
      kernel.off('task:failed', onTaskFailed);
      kernel.off('deadlock:detected', onDeadlock);
      kernel.off('budget-exceeded', onBudgetExceeded);
      kernel.off('health.critical', onHealthCritical);
    },
  };
}
