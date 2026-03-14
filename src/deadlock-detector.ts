import type { AgentId, ResourceId, DeadlockCycle, DeadlockConfig, DeadlockResolution, TypedEventEmitter } from './types.js';
import type { ResourceManager } from './resource-manager.js';

const DEFAULT_CONFIG: DeadlockConfig = {
  enabled: false,
  interval: 2000,
  resolution: 'notify-only',
};

/**
 * Deadlock Detector — uses a Wait-For Graph with DFS cycle detection.
 *
 * Builds a graph where:
 *   Agent A --waits-for--> Resource R --held-by--> Agent B
 * and detects cycles (A waits for B, B waits for A).
 */
export class DeadlockDetector {
  private config: DeadlockConfig;
  private timer?: ReturnType<typeof setInterval>;
  private resourceManager: ResourceManager;
  private emitter?: TypedEventEmitter;
  private detectedCount = 0;
  private resolvedCount = 0;
  private agentPriorities = new Map<AgentId, number>();
  private agentStartTimes = new Map<AgentId, number>();
  private onResolve?: (agentId: AgentId) => void;

  constructor(
    resourceManager: ResourceManager,
    config?: Partial<DeadlockConfig>,
    emitter?: TypedEventEmitter,
  ) {
    this.resourceManager = resourceManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.emitter = emitter;
  }

  start(): void {
    if (this.timer) return;
    if (!this.config.enabled) return;

    this.timer = setInterval(() => this.detect(), this.config.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  setAgentInfo(agentId: AgentId, priority: number, startTime?: number): void {
    this.agentPriorities.set(agentId, priority);
    if (startTime) this.agentStartTimes.set(agentId, startTime);
  }

  setResolveCallback(cb: (agentId: AgentId) => void): void {
    this.onResolve = cb;
  }

  /**
   * Run one cycle detection sweep. Returns any detected deadlock cycles.
   */
  detect(): DeadlockCycle[] {
    const waitGraph = this.resourceManager.getWaitGraph();
    const cycles = this.findCycles(waitGraph);

    for (const cycle of cycles) {
      this.detectedCount++;
      this.emitter?.emit('deadlock:detected', cycle);

      if (this.config.resolution !== 'notify-only') {
        this.resolve(cycle);
      }
    }

    return cycles;
  }

  /**
   * Find all cycles in the wait-for graph using DFS.
   */
  private findCycles(
    waitGraph: Map<AgentId, { waitingFor: ResourceId; heldBy: AgentId[] }>,
  ): DeadlockCycle[] {
    const cycles: DeadlockCycle[] = [];
    const visited = new Set<AgentId>();
    const inStack = new Set<AgentId>();
    const path: Array<{ agent: AgentId; resource: ResourceId }> = [];

    const dfs = (agent: AgentId): void => {
      if (inStack.has(agent)) {
        // Found a cycle — extract it
        const cycleStart = path.findIndex((p) => p.agent === agent);
        if (cycleStart >= 0) {
          const cyclePath = path.slice(cycleStart);
          cycles.push({
            agents: cyclePath.map((p) => p.agent),
            resources: cyclePath.map((p) => p.resource),
            detectedAt: Date.now(),
          });
        }
        return;
      }

      if (visited.has(agent)) return;

      const entry = waitGraph.get(agent);
      if (!entry) return;

      visited.add(agent);
      inStack.add(agent);
      path.push({ agent, resource: entry.waitingFor });

      // This agent is waiting for a resource held by other agents
      for (const holder of entry.heldBy) {
        if (holder !== agent) {
          dfs(holder);
        }
      }

      path.pop();
      inStack.delete(agent);
    };

    for (const agent of waitGraph.keys()) {
      if (!visited.has(agent)) {
        dfs(agent);
      }
    }

    return cycles;
  }

  /**
   * Resolve a deadlock by aborting an agent based on the configured strategy.
   */
  private resolve(cycle: DeadlockCycle): void {
    let victim: AgentId;

    switch (this.config.resolution) {
      case 'abort-lowest':
        victim = this.selectLowestPriority(cycle.agents);
        break;
      case 'abort-youngest':
        victim = this.selectYoungest(cycle.agents);
        break;
      default:
        return; // notify-only
    }

    // Release all resources held by victim
    this.resourceManager.releaseAll(victim);

    // Cancel waiters for the victim's resources
    for (const resourceId of cycle.resources) {
      this.resourceManager.cancelAllWaiters(resourceId, `Deadlock resolution: agent "${victim}" aborted`);
    }

    this.resolvedCount++;
    this.emitter?.emit('deadlock:resolved', cycle, victim);

    if (this.onResolve) {
      this.onResolve(victim);
    }
  }

  private selectLowestPriority(agents: AgentId[]): AgentId {
    return agents.reduce((lowest, agent) => {
      const pA = this.agentPriorities.get(lowest) ?? 0;
      const pB = this.agentPriorities.get(agent) ?? 0;
      return pB < pA ? agent : lowest;
    });
  }

  private selectYoungest(agents: AgentId[]): AgentId {
    return agents.reduce((youngest, agent) => {
      const tA = this.agentStartTimes.get(youngest) ?? 0;
      const tB = this.agentStartTimes.get(agent) ?? 0;
      return tB > tA ? agent : youngest;
    });
  }

  getStats(): { detected: number; resolved: number } {
    return { detected: this.detectedCount, resolved: this.resolvedCount };
  }
}
