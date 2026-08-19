/**
 * Tests for ScenarioLoader (YAML scenario specs, ported from PR #11).
 */

import { describe, it, expect } from 'vitest';
import { ScenarioLoader } from '../src/scenario-loader.js';

const SAMPLE_YAML = `
name: research-pipeline
description: Research → synthesize → write
kernel:
  scheduler:
    strategy: fair-share
    maxConcurrent: 6
    taskTimeout: 45000
  deadlock:
    enabled: true
    resolution: abort-youngest
  enableMetrics: true
resources:
  db-lock:
    type: mutex
  llm-pool:
    type: semaphore
    permits: 3
agents:
  - id: planner
    priority: high
    group: orchestration
    metadata:
      role: planning
  - id: executor
    priority: medium
tasks:
  - id: plan-step
    agent: planner
    name: Generate plan
    resources: [db-lock]
    dependencies: []
    priority: high
`;

describe('ScenarioLoader', () => {
  it('parses a full YAML scenario', () => {
    const scenario = ScenarioLoader.fromYaml(SAMPLE_YAML);

    expect(scenario.name).toBe('research-pipeline');
    expect(scenario.description).toBe('Research → synthesize → write');

    expect(scenario.kernelConfig.scheduler?.strategy).toBe('fair-share');
    expect(scenario.kernelConfig.scheduler?.maxConcurrent).toBe(6);
    expect(scenario.kernelConfig.scheduler?.taskTimeout).toBe(45000);
    expect(scenario.kernelConfig.deadlock?.resolution).toBe('abort-youngest');
    expect(scenario.kernelConfig.enableMetrics).toBe(true);

    expect(scenario.kernelConfig.resources?.['llm-pool']).toEqual({
      type: 'semaphore',
      permits: 3,
    });

    expect(scenario.agents).toHaveLength(2);
    expect(scenario.agents[0]).toMatchObject({
      id: 'planner',
      priority: 'high',
      group: 'orchestration',
    });
    expect(scenario.agents[0].registeredAt).toBeGreaterThan(0);

    expect(scenario.tasks).toHaveLength(1);
    expect(scenario.tasks[0]).toMatchObject({
      id: 'plan-step',
      agent: 'planner',
      resources: ['db-lock'],
      priority: 'high',
    });
  });

  it('applies defaults for omitted fields', () => {
    const scenario = ScenarioLoader.fromYaml('name: minimal\n');
    expect(scenario.name).toBe('minimal');
    expect(scenario.description).toBe('');
    expect(scenario.agents).toEqual([]);
    expect(scenario.tasks).toEqual([]);
  });

  it('rejects non-object YAML', () => {
    expect(() => ScenarioLoader.fromYaml('- just\n- a\n- list\n')).toThrow(/YAML object/);
  });

  it('rejects agents without ids', () => {
    expect(() =>
      ScenarioLoader.fromYaml('name: bad\nagents:\n  - priority: high\n'),
    ).toThrow(/must have an id/);
  });

  it('round-trips through toYaml', () => {
    const original = ScenarioLoader.fromYaml(SAMPLE_YAML);
    const dumped = ScenarioLoader.toYaml(original);
    const restored = ScenarioLoader.fromYaml(dumped);

    expect(restored.name).toBe(original.name);
    expect(restored.agents.map(a => a.id)).toEqual(['planner', 'executor']);
    expect(restored.kernelConfig.scheduler?.strategy).toBe('fair-share');
    expect(restored.kernelConfig.resources?.['db-lock']).toEqual({ type: 'mutex' });
    expect(restored.tasks.map(t => t.id)).toEqual(['plan-step']);
  });

  it('throws for missing files', () => {
    expect(() => ScenarioLoader.fromFile('definitely/not/here.yaml')).toThrow(/not found/);
  });
});
