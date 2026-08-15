/**
 * Agent resource budget system (Issue #1).
 *
 * Enforces per-agent resource limits (token / wall-time / tool-call counts)
 * so a single runaway agent cannot degrade the whole fleet. Emits
 * `budget-exceeded` events instead of hard-killing, for graceful handling.
 */

import type { AgentId } from './types.js';
import type { AgentKernel } from './kernel.js';

export interface ResourceBudget {
  maxTokens?: number;      // per agent per session
  maxWallTimeMs?: number;  // total wall-clock time
  maxToolCalls?: number;   // total tool-call count
  maxMemoryMb?: number;
}

export interface BudgetUsage {
  tokens: number;
  wallTimeMs: number;
  toolCalls: number;
  memoryMb: number;
}

export type BudgetResource = keyof ResourceBudget;

const USAGE_KEY: Record<BudgetResource, keyof BudgetUsage> = {
  maxTokens: 'tokens',
  maxWallTimeMs: 'wallTimeMs',
  maxToolCalls: 'toolCalls',
  maxMemoryMb: 'memoryMb',
};

const DEFAULT_BUDGET: ResourceBudget = {
  maxTokens: 10_000,
  maxWallTimeMs: 30_000,
  maxToolCalls: 50,
  maxMemoryMb: 512,
};

export class ResourceBudgetManager {
  private readonly budgets = new Map<AgentId, ResourceBudget>();
  private readonly usage = new Map<AgentId, BudgetUsage>();
  private readonly defaultBudget: ResourceBudget;
  private readonly kernel: AgentKernel;

  constructor(kernel: AgentKernel, defaultBudget?: ResourceBudget) {
    this.kernel = kernel;
    this.defaultBudget = { ...DEFAULT_BUDGET, ...defaultBudget };
  }

  /** Set (or reset) a per-agent budget. */
  setBudget(agentId: AgentId, budget: ResourceBudget): void {
    this.budgets.set(agentId, budget);
    this.ensureUsage(agentId);
  }

  getBudget(agentId: AgentId): ResourceBudget {
    return this.budgets.get(agentId) ?? this.defaultBudget;
  }

  getUsage(agentId: AgentId): BudgetUsage {
    this.ensureUsage(agentId);
    return { ...this.usage.get(agentId)! };
  }

  /** Record consumption and emit an event on exhaustion. */
  consume(
    agentId: AgentId,
    resource: BudgetResource,
    amount: number,
  ): { exceeded: boolean; usage: BudgetUsage } {
    this.ensureUsage(agentId);
    const usage = this.usage.get(agentId)!;
    const budget = this.getBudget(agentId);
    const usageKey = USAGE_KEY[resource];

    usage[usageKey] += amount;

    const limit = budget[resource];
    const current = usage[usageKey];
    const exceeded = limit !== undefined && current > limit;

    if (exceeded) {
      this.kernel.emit('budget-exceeded', agentId, resource, current);
    }

    return { exceeded, usage: { ...usage } };
  }

  /** Check whether an agent is over any budget. */
  isOverBudget(agentId: AgentId): BudgetResource | null {
    this.ensureUsage(agentId);
    const usage = this.usage.get(agentId)!;
    const budget = this.getBudget(agentId);
    const checks: Array<[BudgetResource, number | undefined, number]> = [
      ['maxTokens', budget.maxTokens, usage.tokens],
      ['maxWallTimeMs', budget.maxWallTimeMs, usage.wallTimeMs],
      ['maxToolCalls', budget.maxToolCalls, usage.toolCalls],
      ['maxMemoryMb', budget.maxMemoryMb, usage.memoryMb],
    ];
    for (const [resource, limit, current] of checks) {
      if (limit !== undefined && current > limit) return resource;
    }
    return null;
  }

  /** Reset usage for an agent (e.g. new session). */
  reset(agentId: AgentId): void {
    this.usage.set(agentId, { tokens: 0, wallTimeMs: 0, toolCalls: 0, memoryMb: 0 });
  }

  private ensureUsage(agentId: AgentId): void {
    if (!this.usage.has(agentId)) {
      this.usage.set(agentId, { tokens: 0, wallTimeMs: 0, toolCalls: 0, memoryMb: 0 });
    }
  }
}
