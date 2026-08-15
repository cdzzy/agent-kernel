/**
 * Tests for v0.2.0 features:
 * - resource budgets (#1)
 * - health monitor (#2/#10)
 * - swarm mode (#3)
 * - model router (#7)
 * - observability (#8)
 * - task decomposition (#9)
 */

import { describe, it, expect } from 'vitest';
import { AgentKernel } from '../src/kernel.js';
import { ResourceBudgetManager } from '../src/resource-budget.js';
import { HealthMonitor } from '../src/health-check.js';
import { SwarmCoordinator } from '../src/swarm.js';
import { ModelRouter } from '../src/model-router.js';
import { Observability } from '../src/observability.js';
import { TaskDecomposer } from '../src/decomposition.js';

// ── Resource budgets (#1) ────────────────────────────────────────────

describe('ResourceBudgetManager', () => {
  it('emits budget-exceeded when over limit', () => {
    const kernel = new AgentKernel();
    const events: unknown[] = [];
    kernel.on('budget-exceeded', (...args) => events.push(args));

    const budgets = new ResourceBudgetManager(kernel, { maxTokens: 100 });
    const result = budgets.consume('agent-1', 'maxTokens', 150);

    expect(result.exceeded).toBe(true);
    expect(events).toHaveLength(1);
    expect(budgets.isOverBudget('agent-1')).toBe('maxTokens');
  });

  it('allows per-agent overrides', () => {
    const kernel = new AgentKernel();
    const budgets = new ResourceBudgetManager(kernel, { maxToolCalls: 10 });
    budgets.setBudget('agent-1', { maxToolCalls: 100 });
    expect(budgets.getBudget('agent-1').maxToolCalls).toBe(100);
  });
});

// ── Health monitor (#2/#10) ──────────────────────────────────────────

describe('HealthMonitor', () => {
  it('reports agents healthy by default', async () => {
    const kernel = new AgentKernel();
    kernel.register('agent-1');
    const monitor = new HealthMonitor(kernel, { interval: 5000 });
    const results = await monitor.runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('healthy');
  });

  it('marks agents unhealthy after repeated failures', async () => {
    const kernel = new AgentKernel();
    kernel.register('agent-1');
    const monitor = new HealthMonitor(kernel, { interval: 5000, unhealthyThreshold: 2 });
    monitor.registerHealthCheck('agent-1', async () => ({ healthy: false, reason: 'down' }));
    await monitor.runChecks();
    await monitor.runChecks();
    expect(monitor.getHealth('agent-1')?.status).toBe('unhealthy');
  });
});

// ── Swarm mode (#3) ──────────────────────────────────────────────────

describe('SwarmCoordinator', () => {
  it('routes to capable agents', () => {
    const swarm = new SwarmCoordinator();
    swarm.registerAgent('researcher', ['web-search', 'summarization']);
    swarm.registerAgent('writer', ['writing']);
    const result = swarm.dispatch({
      task: 'Research AI trends',
      requiredCapabilities: ['web-search'],
    });
    expect(result.agentIds).toEqual(['researcher']);
  });

  it('rejects when no agent matches', () => {
    const swarm = new SwarmCoordinator();
    swarm.registerAgent('writer', ['writing']);
    expect(() => swarm.dispatch({ task: 'x', requiredCapabilities: ['web-search'] })).toThrow();
  });

  it('replicates across agents for fault tolerance', () => {
    const swarm = new SwarmCoordinator({ faultTolerance: { replicationFactor: 2 } });
    swarm.registerAgent('a', ['search']);
    swarm.registerAgent('b', ['search']);
    const result = swarm.dispatch({ task: 'x', requiredCapabilities: ['search'] });
    expect(result.agentIds).toHaveLength(2);
  });
});

// ── Model router (#7) ────────────────────────────────────────────────

describe('ModelRouter', () => {
  const router = new ModelRouter({
    models: { fast: 'gpt-4o-mini', standard: 'claude-haiku', reasoning: 'claude-sonnet' },
  });

  it('routes simple tasks to fast model', () => {
    const route = router.route('What time is it?');
    expect(route.tier).toBe('fast');
  });

  it('routes complex tasks to reasoning model', () => {
    const route = router.route('Prove the formal theorem and design a migration architecture');
    expect(route.tier).toBe('reasoning');
  });

  it('honors explicit tier override', () => {
    const route = router.route('hello', { tier: 'reasoning' });
    expect(route.tier).toBe('reasoning');
  });
});

// ── Observability (#8) ───────────────────────────────────────────────

describe('Observability', () => {
  it('collects metrics and renders Prometheus format', () => {
    const kernel = new AgentKernel();
    kernel.register('agent-1');
    const obs = new Observability(kernel);
    obs.increment('messages_sent', 5);
    obs.recordTokens('agent-1', 1234);
    const metrics = obs.collect();
    expect(metrics.counters.length).toBeGreaterThan(0);
    const prom = obs.renderPrometheus();
    expect(prom).toContain('agent_kernel_tokens_total');
  });
});

// ── Task decomposition (#9) ──────────────────────────────────────────

describe('TaskDecomposer', () => {
  const decomposer = new TaskDecomposer();

  it('decomposes a task into subtasks', () => {
    const result = decomposer.decompose('Research renewable energy trends');
    expect(result.subtasks.length).toBeGreaterThan(0);
  });

  it('renders Mermaid diagram', () => {
    const result = decomposer.decompose('Research AI trends');
    const mermaid = decomposer.toMermaid(result);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('-->');
  });

  it('renders DOT and JSON', () => {
    const result = decomposer.decompose('Write a report');
    expect(decomposer.toDot(result)).toContain('digraph');
    expect(JSON.parse(decomposer.toJSON(result)).rootName).toBe('Write a report');
  });
});
