import type { AgentId, ResourceId, PriorityLevel, AgentDescriptor } from './types.js';
import { PRIORITY_VALUES } from './types.js';
import type { ResourceManager } from './resource-manager.js';

/**
 * Priority Arbiter — dynamic priority management.
 *
 * Features:
 * - Static priority from agent registration
 * - Priority aging: boost starved agents to prevent starvation
 * - Priority inheritance: when low-priority agent holds resource needed
 *   by high-priority agent, temporarily boost the holder's priority
 * - Priority ceiling: optional per-resource priority ceiling protocol
 */
export class PriorityArbiter {
  private agents = new Map<AgentId, AgentPriorityState>();
  private resourceManager?: ResourceManager;

  constructor(resourceManager?: ResourceManager) {
    this.resourceManager = resourceManager;
  }

  registerAgent(agent: AgentDescriptor): void {
    this.agents.set(agent.id, {
      basePriority: PRIORITY_VALUES[agent.priority],
      effectivePriority: PRIORITY_VALUES[agent.priority],
      inheritedFrom: null,
      lastScheduled: 0,
      waitingSince: 0,
    });
  }

  removeAgent(agentId: AgentId): void {
    this.agents.delete(agentId);
  }

  getEffectivePriority(agentId: AgentId): number {
    return this.agents.get(agentId)?.effectivePriority ?? 0;
  }

  getBasePriority(agentId: AgentId): number {
    return this.agents.get(agentId)?.basePriority ?? 0;
  }

  /**
   * Apply priority inheritance.
   * When agent `waiterId` is waiting for a resource held by `holderId`,
   * boost the holder's priority to at least the waiter's level.
   */
  applyInheritance(waiterId: AgentId, holderId: AgentId): void {
    const waiter = this.agents.get(waiterId);
    const holder = this.agents.get(holderId);
    if (!waiter || !holder) return;

    if (waiter.effectivePriority > holder.effectivePriority) {
      holder.effectivePriority = waiter.effectivePriority;
      holder.inheritedFrom = waiterId;
    }
  }

  /**
   * Reset inherited priority back to base when agent releases resource.
   */
  resetInheritance(agentId: AgentId): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.effectivePriority = state.basePriority;
    state.inheritedFrom = null;
  }

  /**
   * Apply aging boost to an agent that has been waiting.
   */
  applyAging(agentId: AgentId, boostPoints: number): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.effectivePriority = Math.min(
      state.effectivePriority + boostPoints,
      200, // cap to prevent runaway priority
    );
  }

  /**
   * Mark agent as scheduled (reset aging).
   */
  markScheduled(agentId: AgentId): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.lastScheduled = Date.now();
    state.waitingSince = 0;
    // Reset to base + any active inheritance
    if (!state.inheritedFrom) {
      state.effectivePriority = state.basePriority;
    }
  }

  markWaiting(agentId: AgentId): void {
    const state = this.agents.get(agentId);
    if (!state) return;
    if (state.waitingSince === 0) {
      state.waitingSince = Date.now();
    }
  }

  /**
   * Compute comparative priority for scheduling decisions.
   * Returns sorted list of agent IDs by effective priority (highest first).
   */
  rank(agentIds: AgentId[]): AgentId[] {
    return [...agentIds].sort((a, b) => {
      const pA = this.getEffectivePriority(a);
      const pB = this.getEffectivePriority(b);
      return pB - pA;
    });
  }

  /**
   * Run a full inheritance check across the wait graph.
   */
  computeInheritanceChain(): void {
    if (!this.resourceManager) return;

    // Reset all inheritances first
    for (const [id, state] of this.agents) {
      state.effectivePriority = state.basePriority;
      state.inheritedFrom = null;
    }

    const waitGraph = this.resourceManager.getWaitGraph();

    for (const [waiterId, { heldBy }] of waitGraph) {
      for (const holderId of heldBy) {
        this.applyInheritance(waiterId, holderId);
      }
    }
  }

  getState(agentId: AgentId): AgentPriorityState | null {
    return this.agents.get(agentId) ?? null;
  }
}

interface AgentPriorityState {
  basePriority: number;
  effectivePriority: number;
  inheritedFrom: AgentId | null;
  lastScheduled: number;
  waitingSince: number;
}
