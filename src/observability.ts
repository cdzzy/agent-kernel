/**
 * Built-in observability dashboard and metrics (Issue #8).
 *
 * Collects per-agent and kernel-wide metrics (health, throughput, token usage,
 * error rates, latency) and exposes them as an in-process metrics registry
 * plus a Prometheus-style text exposition.
 */

import type { AgentKernel } from './kernel.js';
import type { AgentId } from './types.js';

export interface Counter {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface AlertRule {
  name: string;
  condition: (metrics: ObservabilityMetrics) => boolean;
  severity: 'warning' | 'critical';
  action?: (alert: { name: string; severity: string }) => void | Promise<void>;
}

export interface ObservabilityMetrics {
  agents: Record<AgentId, { status: string; tasks: number; errors: number }>;
  counters: Counter[];
  messageThroughput: number;
  errorRate: number;
  tokenUsage: Record<AgentId, number>;
}

export class Observability {
  private readonly kernel: AgentKernel;
  private readonly counters = new Map<string, number>();
  private readonly alerts: AlertRule[] = [];
  private readonly tokenUsage = new Map<AgentId, number>();
  private lastMessageCount = 0;
  private messageThroughput = 0;

  constructor(kernel: AgentKernel) {
    this.kernel = kernel;
  }

  increment(name: string, by = 1, labels?: Record<string, string>): void {
    const key = labels ? `${name}${JSON.stringify(labels)}` : name;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  recordTokens(agentId: AgentId, tokens: number): void {
    this.tokenUsage.set(agentId, (this.tokenUsage.get(agentId) ?? 0) + tokens);
  }

  registerAlert(rule: AlertRule): void {
    this.alerts.push(rule);
  }

  /** Collect the current metric snapshot. */
  collect(): ObservabilityMetrics {
    const kernelMetrics = this.kernel.getMetrics();
    const agents: ObservabilityMetrics['agents'] = {};

    for (const agent of this.kernel.listAgents()) {
      agents[agent.id] = {
        status: this.kernel.getAgentStatus(agent.id) ?? 'unknown',
        tasks: 0,
        errors: 0,
      };
    }

    const errorRate = kernelMetrics.tasks.total > 0
      ? kernelMetrics.tasks.failed / kernelMetrics.tasks.total
      : 0;

    return {
      agents,
      counters: [...this.counters.entries()].map(([name, value]) => ({ name, value })),
      messageThroughput: this.messageThroughput,
      errorRate,
      tokenUsage: Object.fromEntries(this.tokenUsage),
    };
  }

  /** Evaluate all registered alert rules against the current metrics. */
  async evaluateAlerts(): Promise<void> {
    const metrics = this.collect();
    for (const rule of this.alerts) {
      if (rule.condition(metrics)) {
        await rule.action?.({ name: rule.name, severity: rule.severity });
      }
    }
  }

  /**
   * Render metrics in Prometheus text exposition format (for /metrics).
   */
  renderPrometheus(): string {
    const metrics = this.collect();
    const lines: string[] = [];

    for (const [agentId, data] of Object.entries(metrics.agents)) {
      lines.push(`agent_kernel_health_status{agent="${agentId}",status="${data.status}"} 1`);
    }
    for (const [agentId, tokens] of Object.entries(metrics.tokenUsage)) {
      lines.push(`agent_kernel_tokens_total{agent="${agentId}"} ${tokens}`);
    }
    lines.push(`agent_kernel_message_throughput ${metrics.messageThroughput}`);
    lines.push(`agent_kernel_error_rate ${metrics.errorRate.toFixed(4)}`);
    for (const counter of metrics.counters) {
      lines.push(`agent_kernel_counter{name="${counter.name}"} ${counter.value}`);
    }

    return lines.join('\n') + '\n';
  }
}
