/**
 * Swarm mode for decentralized agent collaboration (Issue #3).
 *
 * Capability-aware routing without a central coordinator: agents advertise
 * capabilities, and tasks are dispatched to any available agent that matches
 * the required capabilities (with optional fault tolerance via replication).
 */

import type { AgentId } from './types.js';

export interface SwarmAgentInfo {
  agentId: AgentId;
  capabilities: string[];
  maxConcurrentTasks: number;
  activeTasks: number;
  registeredAt: number;
}

export interface SwarmConfig {
  discovery?: 'gossip' | 'registry';
  routing?: 'capability-aware';
  faultTolerance?: {
    replicationFactor?: number;
    timeout?: number;
  };
}

export interface DispatchOptions {
  task: string;
  requiredCapabilities: string[];
  replication?: number;
}

export interface DispatchResult {
  agentIds: AgentId[];
  requiredCapabilities: string[];
  dispatchedAt: number;
}

const DEFAULT_CONFIG: Required<SwarmConfig> = {
  discovery: 'registry',
  routing: 'capability-aware',
  faultTolerance: { replicationFactor: 1, timeout: 30_000 },
};

export class SwarmCoordinator {
  private readonly agents = new Map<AgentId, SwarmAgentInfo>();
  private readonly config: Required<SwarmConfig>;

  constructor(config: SwarmConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register (or self-advertise) an agent's capabilities. */
  registerAgent(agentId: AgentId, capabilities: string[], maxConcurrentTasks = 3): void {
    this.agents.set(agentId, {
      agentId,
      capabilities,
      maxConcurrentTasks,
      activeTasks: 0,
      registeredAt: Date.now(),
    });
  }

  unregisterAgent(agentId: AgentId): void {
    this.agents.delete(agentId);
  }

  getAgent(agentId: AgentId): SwarmAgentInfo | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): SwarmAgentInfo[] {
    return [...this.agents.values()];
  }

  /**
   * Find agents that match all required capabilities.
   */
  findMatching(requiredCapabilities: string[]): SwarmAgentInfo[] {
    return [...this.agents.values()].filter((a) =>
      requiredCapabilities.every((cap) => a.capabilities.includes(cap)),
    );
  }

  /**
   * Dispatch a task to capable agents (decentralized, no coordinator needed).
   * Replicates across `replication` agents when fault tolerance is configured.
   */
  dispatch(options: DispatchOptions): DispatchResult {
    const required = options.requiredCapabilities;
    const matching = this.findMatching(required)
      .filter((a) => a.activeTasks < a.maxConcurrentTasks)
      .sort((a, b) => a.activeTasks - b.activeTasks); // least-busy first

    if (matching.length === 0) {
      throw new Error(`No available agent matches capabilities: ${required.join(', ')}`);
    }

    const replication = Math.min(
      options.replication ?? this.config.faultTolerance.replicationFactor ?? 1,
      matching.length,
    );

    const selected = matching.slice(0, replication);
    for (const agent of selected) agent.activeTasks++;

    return {
      agentIds: selected.map((a) => a.agentId),
      requiredCapabilities: required,
      dispatchedAt: Date.now(),
    };
  }

  /** Release an agent's task slot. */
  complete(agentId: AgentId): void {
    const agent = this.agents.get(agentId);
    if (agent && agent.activeTasks > 0) agent.activeTasks--;
  }
}
