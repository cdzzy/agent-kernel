/**
 * Health Check Module for AgentKernel
 * 
 * Provides system health monitoring, readiness checks, and metrics
 * for production deployments.
 */

import type { AgentKernel } from './kernel.js';
import type { AgentId, TaskId, ResourceId } from './types.js';

export interface HealthStatus {
  healthy: boolean;
  timestamp: number;
  uptime: number;
  version: string;
  checks: HealthCheck[];
  summary: {
    totalAgents: number;
    activeTasks: number;
    pendingTasks: number;
    resourceUtilization: number;
    deadlockRisk: 'none' | 'low' | 'medium' | 'high';
  };
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  duration?: number;
}

export interface ReadinessCheck {
  name: string;
  ready: boolean;
  details?: Record<string, unknown>;
}

export class HealthMonitor {
  private kernel: AgentKernel;
  private startTime: number;
  private readonly version: string;

  constructor(kernel: AgentKernel, version: string = '1.0.0') {
    this.kernel = kernel;
    this.startTime = Date.now();
    this.version = version;
  }

  /**
   * Get comprehensive health status of the kernel
   */
  async check(): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];
    let allHealthy = true;

    // Check kernel state
    const kernelCheck = this.checkKernelState();
    checks.push(kernelCheck);
    if (kernelCheck.status === 'fail') allHealthy = false;

    // Check agent health
    const agentCheck = await this.checkAgents();
    checks.push(agentCheck);
    if (agentCheck.status === 'fail') allHealthy = false;

    // Check resources
    const resourceCheck = await this.checkResources();
    checks.push(resourceCheck);
    if (resourceCheck.status === 'fail') allHealthy = false;

    // Check deadlock risk
    const deadlockCheck = await this.checkDeadlockRisk();
    checks.push(deadlockCheck);
    if (deadlockCheck.status === 'fail') allHealthy = false;

    // Calculate summary
    const summary = this.calculateSummary();

    return {
      healthy: allHealthy,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: this.version,
      checks,
      summary,
    };
  }

  private checkKernelState(): HealthCheck {
    const start = Date.now();
    try {
      if (!this.kernel.isRunning?.()) {
        return {
          name: 'kernel_state',
          status: 'fail',
          message: 'Kernel is not running',
          duration: Date.now() - start,
        };
      }
      return {
        name: 'kernel_state',
        status: 'pass',
        message: 'Kernel is operational',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'kernel_state',
        status: 'fail',
        message: `Kernel check failed: ${error}`,
        duration: Date.now() - start,
      };
    }
  }

  private async checkAgents(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const agents = this.kernel.listAgents?.() ?? [];
      const idleCount = agents.filter((a: { status: string }) => a.status === 'idle').length;
      const stuckAgents = agents.filter((a: { status: string }) => 
        a.status === 'waiting' && Date.now() - a.lastActivity > 300000 // 5 min timeout
      ).length;

      if (stuckAgents > agents.length * 0.3) {
        return {
          name: 'agents',
          status: 'warn',
          message: `${stuckAgents} agents may be stuck (>30% waiting >5min)`,
          duration: Date.now() - start,
        };
      }

      return {
        name: 'agents',
        status: 'pass',
        message: `${agents.length} agents registered, ${idleCount} idle`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'agents',
        status: 'fail',
        message: `Agent check failed: ${error}`,
        duration: Date.now() - start,
      };
    }
  }

  private async checkResources(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const resources = this.kernel.resources?.list?.() ?? [];
      const contended = resources.filter((r: { waitQueue: unknown[] }) => r.waitQueue?.length > 0).length;

      if (contended > resources.length * 0.5) {
        return {
          name: 'resources',
          status: 'warn',
          message: `${contended}/${resources.length} resources have waiting agents`,
          duration: Date.now() - start,
        };
      }

      return {
        name: 'resources',
        status: 'pass',
        message: `${resources.length} resources managed, ${contended} contended`,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'resources',
        status: 'fail',
        message: `Resource check failed: ${error}`,
        duration: Date.now() - start,
      };
    }
  }

  private async checkDeadlockRisk(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const detected = this.kernel.deadlockDetector?.detect?.() ?? { cycles: [] };
      const cycles = detected.cycles?.length ?? 0;

      if (cycles > 0) {
        return {
          name: 'deadlock_risk',
          status: 'fail',
          message: `${cycles} potential deadlock cycle(s) detected`,
          duration: Date.now() - start,
        };
      }

      return {
        name: 'deadlock_risk',
        status: 'pass',
        message: 'No deadlock cycles detected',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'deadlock_risk',
        status: 'warn',
        message: `Deadlock detection unavailable: ${error}`,
        duration: Date.now() - start,
      };
    }
  }

  private calculateSummary(): HealthStatus['summary'] {
    const agents = this.kernel.listAgents?.() ?? [];
    const resources = this.kernel.resources?.list?.() ?? [];

    return {
      totalAgents: agents.length,
      activeTasks: agents.filter((a: { status: string }) => a.status === 'running').length,
      pendingTasks: this.kernel.scheduler?.queue?.length ?? 0,
      resourceUtilization: this.calculateUtilization(resources),
      deadlockRisk: this.assessDeadlockRisk(agents, resources),
    };
  }

  private calculateUtilization(resources: unknown[]): number {
    if (resources.length === 0) return 0;
    const utilized = resources.filter((r: { owners: unknown[] }) => r.owners?.length > 0).length;
    return Math.round((utilized / resources.length) * 100);
  }

  private assessDeadlockRisk(
    agents: unknown[],
    resources: unknown[]
  ): 'none' | 'low' | 'medium' | 'high' {
    const waitingRatio = agents.filter((a: { status: string }) => a.status === 'waiting').length / Math.max(agents.length, 1);
    const contentionRatio = resources.filter((r: { waitQueue: unknown[] }) => r.waitQueue?.length > 1).length / Math.max(resources.length, 1);

    if (waitingRatio > 0.5 || contentionRatio > 0.3) return 'high';
    if (waitingRatio > 0.3 || contentionRatio > 0.1) return 'medium';
    if (waitingRatio > 0.1) return 'low';
    return 'none';
  }

  /**
   * Quick readiness check for load balancers
   */
  async readiness(): Promise<ReadinessCheck> {
    return {
      name: 'kernel_ready',
      ready: this.kernel.isRunning?.() ?? false,
      details: {
        agents: (this.kernel.listAgents?.() ?? []).length,
        resources: (this.kernel.resources?.list?.() ?? []).length,
      },
    };
  }

  /**
   * Quick liveness check for containers
   */
  liveness(): { alive: boolean } {
    return { alive: this.kernel.isRunning?.() ?? false };
  }
}

export default HealthMonitor;
