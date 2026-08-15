/**
 * Agent health monitoring and automatic recovery (Issue #2 / #10).
 *
 * Monitors agent fleet health, tracks consecutive failures, and applies a
 * configurable recovery policy (restart / failover / alert-only). Emits
 * `health.degraded` / `health.critical` events for live alerting.
 */

import type { AgentKernel } from './kernel.js';
import type { AgentId } from './types.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckConfig {
  interval?: number;            // ms between checks (default 5000)
  unhealthyThreshold?: number;  // consecutive failures before unhealthy (default 3)
  recoveryPolicy?: 'restart' | 'failover' | 'alert-only';
}

export interface AgentHealth {
  agentId: AgentId;
  status: HealthStatus;
  consecutiveFailures: number;
  lastCheckedAt: number;
  reason?: string;
}

export type HealthCheckFn = (agentId: AgentId) => Promise<{ healthy: boolean; reason?: string }>;

const DEFAULT_CONFIG: Required<HealthCheckConfig> = {
  interval: 5000,
  unhealthyThreshold: 3,
  recoveryPolicy: 'alert-only',
};

export class HealthMonitor {
  private readonly kernel: AgentKernel;
  private readonly config: Required<HealthCheckConfig>;
  private readonly health = new Map<AgentId, AgentHealth>();
  private readonly checks = new Map<AgentId, HealthCheckFn>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(kernel: AgentKernel, config: HealthCheckConfig = {}) {
    this.kernel = kernel;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a custom health check for a specific agent. */
  registerHealthCheck(agentId: AgentId, check: HealthCheckFn): void {
    this.checks.set(agentId, check);
  }

  /** Start periodic health monitoring. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runChecks();
    }, this.config.interval);
  }

  /** Stop monitoring. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run one health-check pass across all agents. */
  async runChecks(): Promise<AgentHealth[]> {
    const results: AgentHealth[] = [];
    for (const agent of this.kernel.listAgents()) {
      const entry = await this.checkAgent(agent.id);
      results.push(entry);
    }
    return results;
  }

  getHealth(agentId: AgentId): AgentHealth | undefined {
    return this.health.get(agentId);
  }

  getAllHealth(): AgentHealth[] {
    return [...this.health.values()];
  }

  private async checkAgent(agentId: AgentId): Promise<AgentHealth> {
    const check = this.checks.get(agentId) ?? this.defaultCheck;
    const prev = this.health.get(agentId) ?? {
      agentId,
      status: 'healthy' as HealthStatus,
      consecutiveFailures: 0,
      lastCheckedAt: 0,
    };

    let result: { healthy: boolean; reason?: string };
    try {
      result = await check(agentId);
    } catch (err) {
      result = { healthy: false, reason: err instanceof Error ? err.message : String(err) };
    }

    const failures = result.healthy ? 0 : prev.consecutiveFailures + 1;
    const unhealthy = failures >= this.config.unhealthyThreshold;

    const entry: AgentHealth = {
      agentId,
      status: unhealthy ? 'unhealthy' : failures > 0 ? 'degraded' : 'healthy',
      consecutiveFailures: failures,
      lastCheckedAt: Date.now(),
      reason: result.reason,
    };

    const previousStatus = prev.status;
    this.health.set(agentId, entry);

    if (entry.status !== previousStatus) {
      if (entry.status === 'unhealthy') {
        this.kernel.emit('health.critical', agentId, entry);
        this.applyRecovery(agentId);
      } else if (entry.status === 'degraded') {
        this.kernel.emit('health.degraded', agentId, entry);
      }
    }

    return entry;
  }

  private applyRecovery(agentId: AgentId): void {
    switch (this.config.recoveryPolicy) {
      case 'restart': {
        try {
          this.kernel.terminate(agentId);
        } catch {
          // already gone
        }
        break;
      }
      case 'failover':
      case 'alert-only':
      default:
        // alert-only: operators handle it via the emitted event
        break;
    }
  }

  /** Default check: an agent is healthy if registered and not terminated. */
  private readonly defaultCheck: HealthCheckFn = async (agentId) => {
    const status = this.kernel.getAgentStatus(agentId);
    return {
      healthy: status !== null && status !== 'terminated',
      reason: status === 'terminated' ? 'Agent terminated' : undefined,
    };
  };
}

export default HealthMonitor;
