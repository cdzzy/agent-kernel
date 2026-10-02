/**
 * Handoff orchestration for agent-kernel
 *
 * Implements runtime task handoff between agents (the pattern popularized by
 * OpenAI Swarm and Anthropic's multi-agent research system): an agent's
 * handler can, at any point during execution, yield control to another agent
 * by throwing a `HandoffSignal`.
 *
 * Two modes:
 * - `transfer` — control moves to the target agent; the sender exits the
 *   chain. Like a `goto`: A hands the task to B and B carries it to the end.
 * - `delegate` — the target runs; when it returns, its output is fed back
 *   into the sender's handler as the new payload. Like a function call:
 *   A calls B, B returns, A resumes with the result. Delegate frames form a
 *   stack, so nested delegations unwind in the natural order.
 *
 * Targets are resolved in two steps: an exact agent id wins first; otherwise
 * the target is treated as a capability name and routed to the least-busy
 * agent that advertises it. Every hop is journaled into an auditable chain,
 * transfer cycles fail fast, and runaway chains are capped by `maxChainDepth`.
 *
 * Every hop is executed through `kernel.submit()`, so handoff traffic flows
 * through the full scheduling pipeline (priorities, resources, metrics, and
 * the TraceShield audit bridge all observe it).
 *
 * Usage:
 *   const handoff = new HandoffCoordinator(kernel, { maxChainDepth: 8 });
 *
 *   handoff.register('researcher', async (ctx) => {
 *     const draft = await research(ctx.payload);
 *     throw new HandoffSignal('writing', { payload: { draft } }); // transfer
 *   }, ['research']);
 *
 *   handoff.register('writer', (ctx) => polish(ctx.payload.draft), ['writing']);
 *
 *   const result = await handoff.execute('researcher', {
 *     taskName: 'report',
 *     payload: { topic: 'AI' },
 *   });
 *   console.log(result.output, result.chain);
 */

import type { AgentId } from './types.js';
import { TypedEventEmitter } from './types.js';
import type { AgentKernel } from './kernel.js';

// ---- Types ----

export type HandoffMode = 'transfer' | 'delegate';

export type HandoffStatus = 'completed' | 'failed' | 'timeout' | 'cycle' | 'max-depth';

/** One journaled hop in a handoff chain (also used for delegate returns). */
export interface HandoffRecord {
  from: AgentId;
  to: AgentId;
  at: number;
  reason?: string;
  mode: HandoffMode;
}

/** Everything a handler sees about the chain it is executing in. */
export interface HandoffContext {
  taskName: string;
  payload: unknown;
  history: readonly HandoffRecord[];
  depth: number;
  origin: AgentId;
  metadata?: Record<string, unknown>;
}

export type HandoffHandler = (context: HandoffContext) => unknown | Promise<unknown>;

export interface HandoffSignalOptions {
  /** Replacement payload for the next agent. Omit to keep the current one. */
  payload?: unknown;
  /** Human-readable rationale, journaled into the chain for audits. */
  reason?: string;
  /** `transfer` (default) hands control over; `delegate` returns the result. */
  mode?: HandoffMode;
}

/**
 * Thrown (or raised) by a handler to hand the task to another agent.
 * The coordinator intercepts it — it never surfaces to the caller.
 */
export class HandoffSignal extends Error {
  readonly target: string;
  readonly payload?: unknown;
  readonly reason?: string;
  readonly mode: HandoffMode;

  constructor(target: string, options: HandoffSignalOptions = {}) {
    super(
      `handoff -> ${target}` +
        (options.mode === 'delegate' ? ' (delegate)' : '') +
        (options.reason ? `: ${options.reason}` : ''),
    );
    this.name = 'HandoffSignal';
    this.target = target;
    this.payload = options.payload;
    this.reason = options.reason;
    this.mode = options.mode ?? 'transfer';
  }
}

export interface HandoffExecuteOptions {
  taskName: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
  /** Wall-clock budget for the whole chain (all hops combined). */
  timeoutMs?: number;
}

export interface HandoffConfig {
  /** Max handler executions per chain (transfers + delegates + returns). Default 10. */
  maxChainDepth?: number;
}

export interface HandoffResult<T = unknown> {
  output: T;
  chain: HandoffRecord[];
  finalAgent: AgentId;
  origin: AgentId;
  depth: number;
  status: HandoffStatus;
  error?: Error;
}

/**
 * Thrown when a chain ends abnormally. Carries the full `HandoffResult`
 * (chain included) so callers can audit exactly where and why it stopped.
 */
export class HandoffExecutionError extends Error {
  readonly result: HandoffResult;

  constructor(message: string, result: HandoffResult) {
    super(message);
    this.name = 'HandoffExecutionError';
    this.result = result;
  }
}

export interface HandoffStats {
  totalHandoffs: number;
  chainsCompleted: number;
  chainsFailed: number;
  cyclesDetected: number;
}

/** Typed event surface for the HandoffCoordinator. */
export interface HandoffEvents {
  handoff: (record: HandoffRecord) => void;
  completed: (result: HandoffResult) => void;
  failed: (result: HandoffResult) => void;
}

// ---- Coordinator ----

const DEFAULT_CONFIG: Required<HandoffConfig> = {
  maxChainDepth: 10,
};

type HopOutcome =
  | { kind: 'return'; output: unknown }
  | { kind: 'signal'; signal: HandoffSignal }
  | { kind: 'error'; error: Error }
  | { kind: 'timeout' };

export class HandoffCoordinator extends TypedEventEmitter<HandoffEvents> {
  private readonly kernel: AgentKernel;
  private readonly config: Required<HandoffConfig>;
  private readonly handlers = new Map<AgentId, HandoffHandler>();
  private readonly capabilities = new Map<string, Set<AgentId>>();
  private readonly activeHops = new Map<AgentId, number>();
  private readonly stats: HandoffStats = {
    totalHandoffs: 0,
    chainsCompleted: 0,
    chainsFailed: 0,
    cyclesDetected: 0,
  };

  constructor(kernel: AgentKernel, config: HandoffConfig = {}) {
    super();
    this.kernel = kernel;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a handler for an agent, optionally advertising capabilities. */
  register(agentId: AgentId, handler: HandoffHandler, capabilities: string[] = []): this {
    this.handlers.set(agentId, handler);
    for (const cap of capabilities) {
      let agents = this.capabilities.get(cap);
      if (!agents) {
        agents = new Set<AgentId>();
        this.capabilities.set(cap, agents);
      }
      agents.add(agentId);
    }
    return this;
  }

  /** Remove an agent's handler and all its capability advertisements. */
  unregister(agentId: AgentId): this {
    this.handlers.delete(agentId);
    for (const [cap, agents] of this.capabilities) {
      agents.delete(agentId);
      if (agents.size === 0) this.capabilities.delete(cap);
    }
    return this;
  }

  getStats(): Readonly<HandoffStats> {
    return { ...this.stats };
  }

  /**
   * Run a task starting at `origin`, following handoff signals until an agent
   * returns a plain value (chain completes) or the chain fails.
   *
   * Failures throw `HandoffExecutionError` carrying the full result
   * (status, chain, error). Success returns the `HandoffResult` directly.
   */
  async execute<T = unknown>(
    origin: AgentId,
    options: HandoffExecuteOptions,
  ): Promise<HandoffResult<T>> {
    if (!this.kernel.getAgent(origin)) {
      throw new Error(`Agent "${origin}" is not registered in the kernel`);
    }

    const chain: HandoffRecord[] = [];
    const visited = new Set<AgentId>([origin]); // transfer targets already seen
    const delegateStack: AgentId[] = []; // senders awaiting a delegate result
    const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : Infinity;

    let current: AgentId = origin;
    let payload = options.payload;
    let depth = 0;

    const fail = (status: HandoffStatus, error: Error): never => {
      const result: HandoffResult = {
        output: undefined,
        chain,
        finalAgent: current,
        origin,
        depth,
        status,
        error,
      };
      this.stats.chainsFailed++;
      this.emit('failed', result);
      throw new HandoffExecutionError(error.message, result);
    };

    const recordHop = (from: AgentId, to: AgentId, mode: HandoffMode, reason?: string): void => {
      const record: HandoffRecord = { from, to, at: Date.now(), reason, mode };
      chain.push(record);
      this.stats.totalHandoffs++;
      this.emit('handoff', record);
    };

    for (;;) {
      if (depth >= this.config.maxChainDepth) {
        return fail(
          'max-depth',
          new Error(
            `Handoff chain for "${options.taskName}" exceeded maxChainDepth ` +
              `(${this.config.maxChainDepth})`,
          ),
        );
      }
      if (Date.now() >= deadline) {
        return fail(
          'timeout',
          new Error(`Handoff chain for "${options.taskName}" timed out after ${options.timeoutMs}ms`),
        );
      }

      const handler = this.handlers.get(current);
      if (!handler) {
        return fail('failed', new Error(`No handoff handler registered for agent "${current}"`));
      }

      const context: HandoffContext = {
        taskName: options.taskName,
        payload,
        history: [...chain],
        depth,
        origin,
        metadata: options.metadata,
      };

      const outcome = await this.runHop(current, handler, context, deadline);
      depth++;

      if (outcome.kind === 'timeout') {
        return fail(
          'timeout',
          new Error(`Handoff chain for "${options.taskName}" timed out after ${options.timeoutMs}ms`),
        );
      }
      if (outcome.kind === 'error') {
        return fail('failed', outcome.error);
      }

      if (outcome.kind === 'return') {
        const caller = delegateStack.pop();
        if (caller === undefined) {
          const result: HandoffResult<T> = {
            output: outcome.output as T,
            chain,
            finalAgent: current,
            origin,
            depth,
            status: 'completed',
          };
          this.stats.chainsCompleted++;
          this.emit('completed', result);
          return result;
        }
        // Unwind one delegate frame: the caller resumes with the result.
        recordHop(current, caller, 'delegate', 'delegate-return');
        current = caller;
        payload = outcome.output;
        continue;
      }

      // Handoff signal path
      const signal = outcome.signal;

      // Reject the signal before journaling it if following it would
      // exceed the depth budget (never record a hop that cannot execute).
      if (depth >= this.config.maxChainDepth) {
        return fail(
          'max-depth',
          new Error(
            `Handoff chain for "${options.taskName}" exceeded maxChainDepth ` +
              `(${this.config.maxChainDepth})`,
          ),
        );
      }

      let target: AgentId;
      try {
        target = this.resolveTarget(signal.target);
      } catch (err) {
        return fail('failed', err instanceof Error ? err : new Error(String(err)));
      }

      if (signal.mode === 'transfer' && visited.has(target)) {
        this.stats.cyclesDetected++;
        return fail(
          'cycle',
          new Error(
            `Handoff cycle detected: "${current}" -> "${target}" would revisit an agent ` +
              `already in the transfer chain`,
          ),
        );
      }

      recordHop(current, target, signal.mode, signal.reason);

      if (signal.mode === 'transfer') {
        visited.add(target);
      } else {
        delegateStack.push(current);
      }

      if (signal.payload !== undefined) {
        payload = signal.payload;
      }
      current = target;
    }
  }

  // ---- Internals ----

  /** Exact agent id first; otherwise treat the target as a capability name. */
  private resolveTarget(target: string): AgentId {
    if (this.handlers.has(target)) {
      return target;
    }

    const candidates = this.capabilities.get(target);
    if (candidates && candidates.size > 0) {
      let best: AgentId | undefined;
      let bestLoad = Infinity;
      for (const agentId of candidates) {
        // Skip agents the kernel does not know — submitting to them would fail.
        if (!this.kernel.getAgent(agentId)) continue;
        const load = this.activeHops.get(agentId) ?? 0;
        if (load < bestLoad) {
          bestLoad = load;
          best = agentId;
        }
      }
      if (best !== undefined) return best;
    }

    throw new Error(
      `Handoff target "${target}" is neither a registered agent nor a known capability`,
    );
  }

  /**
   * Execute one hop through the kernel's scheduler so the full pipeline
   * (priority, resources, metrics, TraceShield bridge) applies to it.
   * A `HandoffSignal` thrown by the handler arrives here as a task failure
   * and is intercepted; any other error ends the chain.
   */
  private runHop(
    agentId: AgentId,
    handler: HandoffHandler,
    context: HandoffContext,
    deadline: number,
  ): Promise<HopOutcome> {
    this.activeHops.set(agentId, (this.activeHops.get(agentId) ?? 0) + 1);

    return new Promise<HopOutcome>((resolve) => {
      let taskId: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        this.kernel.off('task:completed', onCompleted);
        this.kernel.off('task:failed', onFailed);
        const load = (this.activeHops.get(agentId) ?? 1) - 1;
        if (load <= 0) this.activeHops.delete(agentId);
        else this.activeHops.set(agentId, load);
      };

      const onCompleted = (task: { id: string; result?: unknown }): void => {
        if (task.id !== taskId) return;
        cleanup();
        resolve({ kind: 'return', output: task.result });
      };

      const onFailed = (task: { id: string; error?: Error }): void => {
        if (task.id !== taskId) return;
        cleanup();
        const error = task.error;
        if (error instanceof HandoffSignal) {
          resolve({ kind: 'signal', signal: error });
        } else {
          resolve({ kind: 'error', error: error ?? new Error('Task failed') });
        }
      };

      // Abandon the wait on timeout; the underlying kernel task keeps running.
      if (deadline < Infinity) {
        timer = setTimeout(() => {
          cleanup();
          resolve({ kind: 'timeout' });
        }, Math.max(0, deadline - Date.now()));
      }

      this.kernel.on('task:completed', onCompleted);
      this.kernel.on('task:failed', onFailed);

      try {
        const descriptor = this.kernel.submit(agentId, {
          name: `handoff:${context.taskName}#${context.depth}`,
          handler: () => handler(context),
        });
        taskId = descriptor.id;
      } catch (err) {
        cleanup();
        resolve({
          kind: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    });
  }
}
