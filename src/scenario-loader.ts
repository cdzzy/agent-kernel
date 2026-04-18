import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';          // peer dep — already in most TS projects
import type {
  AgentId,
  AgentDescriptor,
  KernelConfig,
  PriorityLevel,
  ResourceConfig,
  ResourceId,
  SchedulingStrategy,
  TaskId,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// ScenarioLoader
//
// Loads a YAML "scenario spec" and translates it into KernelConfig + an
// ordered list of agent descriptors and task wiring instructions.
//
// Why: trending YAML-first pattern (WorldSeed, 2026-04-18 AI Trending) shows
// strong community demand for declarative Agent behavior description.
// This bridges that pattern with agent-kernel's existing infrastructure.
//
// YAML schema (scenario.yaml):
//   name: my-scenario
//   description: Optional human-readable description
//
//   kernel:                        # maps to KernelConfig
//     scheduler:
//       strategy: priority         # fifo | priority | fair-share | round-robin
//       maxConcurrent: 4
//       taskTimeout: 30000
//     deadlock:
//       enabled: true
//       resolution: abort-lowest
//     enableMetrics: true
//
//   resources:                     # maps to KernelConfig.resources
//     db-lock:
//       type: mutex
//     llm-pool:
//       type: semaphore
//       permits: 3
//
//   agents:
//     - id: planner
//       priority: high
//       group: orchestration
//       metadata:
//         role: planning
//     - id: executor
//       priority: medium
//
//   tasks:                         # optional wiring hints (used by ScenarioRunner)
//     - id: plan-step
//       agent: planner
//       name: "Generate plan"
//       resources: [db-lock]
//       dependencies: []
//       priority: high
//
// ─────────────────────────────────────────────────────────────────────────────

// ── Schema types (loosely typed for flexibility) ──────────────────────────────

export interface ScenarioKernelSpec {
  scheduler?: {
    strategy?: SchedulingStrategy;
    maxConcurrent?: number;
    taskTimeout?: number;
    agingInterval?: number;
    agingBoost?: number;
  };
  deadlock?: {
    enabled?: boolean;
    interval?: number;
    resolution?: 'abort-lowest' | 'abort-youngest' | 'notify-only';
  };
  enableMetrics?: boolean;
}

export interface ScenarioAgentSpec {
  id: AgentId;
  priority?: PriorityLevel;
  group?: string;
  metadata?: Record<string, unknown>;
}

export interface ScenarioTaskSpec {
  id: TaskId;
  agent: AgentId;
  name: string;
  resources?: ResourceId[];
  dependencies?: TaskId[];
  priority?: PriorityLevel;
}

export interface ScenarioResourceSpec {
  [resourceId: string]: ResourceConfig;
}

export interface ScenarioSpec {
  name: string;
  description?: string;
  kernel?: ScenarioKernelSpec;
  resources?: ScenarioResourceSpec;
  agents?: ScenarioAgentSpec[];
  tasks?: ScenarioTaskSpec[];
}

// ── Parsed output ─────────────────────────────────────────────────────────────

export interface LoadedScenario {
  name: string;
  description: string;
  kernelConfig: KernelConfig;
  agents: AgentDescriptor[];
  tasks: ScenarioTaskSpec[];
}

// ─────────────────────────────────────────────────────────────────────────────

export class ScenarioLoader {
  /**
   * Load and validate a scenario from a YAML file path.
   * Throws if the file is missing or the schema is invalid.
   */
  static fromFile(filePath: string): LoadedScenario {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
      throw new Error(`ScenarioLoader: file not found — ${abs}`);
    }
    const raw = fs.readFileSync(abs, 'utf8');
    return ScenarioLoader.fromYaml(raw);
  }

  /**
   * Parse and validate a YAML string directly.
   */
  static fromYaml(yamlString: string): LoadedScenario {
    let spec: unknown;
    try {
      spec = yaml.load(yamlString);
    } catch (err) {
      throw new Error(`ScenarioLoader: YAML parse error — ${String(err)}`);
    }

    if (typeof spec !== 'object' || spec === null) {
      throw new Error('ScenarioLoader: scenario must be a YAML object');
    }

    return ScenarioLoader._parse(spec as Record<string, unknown>);
  }

  /**
   * Serialize a LoadedScenario back to a YAML string.
   * Useful for generating scenario templates programmatically.
   */
  static toYaml(scenario: LoadedScenario): string {
    const spec: ScenarioSpec = {
      name: scenario.name,
      description: scenario.description,
      kernel: ScenarioLoader._kernelConfigToSpec(scenario.kernelConfig),
      resources: scenario.kernelConfig.resources as ScenarioResourceSpec,
      agents: scenario.agents.map(a => ({
        id: a.id,
        priority: a.priority,
        group: a.group,
        metadata: a.metadata,
      })),
      tasks: scenario.tasks,
    };
    return yaml.dump(spec, { indent: 2, lineWidth: 100 });
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private static _parse(raw: Record<string, unknown>): LoadedScenario {
    const name = String(raw['name'] ?? 'unnamed-scenario');
    const description = String(raw['description'] ?? '');

    const kernelSpec = (raw['kernel'] ?? {}) as ScenarioKernelSpec;
    const resourceSpec = (raw['resources'] ?? {}) as ScenarioResourceSpec;
    const agentSpecs = Array.isArray(raw['agents'])
      ? (raw['agents'] as ScenarioAgentSpec[])
      : [];
    const taskSpecs = Array.isArray(raw['tasks'])
      ? (raw['tasks'] as ScenarioTaskSpec[])
      : [];

    // Validate agents have IDs
    for (const a of agentSpecs) {
      if (!a.id) throw new Error('ScenarioLoader: each agent must have an id');
    }

    const kernelConfig: KernelConfig = {
      scheduler: kernelSpec.scheduler
        ? {
            strategy: kernelSpec.scheduler.strategy ?? 'priority',
            maxConcurrent: kernelSpec.scheduler.maxConcurrent ?? 4,
            taskTimeout: kernelSpec.scheduler.taskTimeout,
            agingInterval: kernelSpec.scheduler.agingInterval,
            agingBoost: kernelSpec.scheduler.agingBoost,
          }
        : undefined,
      deadlock: kernelSpec.deadlock
        ? {
            enabled: kernelSpec.deadlock.enabled ?? true,
            interval: kernelSpec.deadlock.interval ?? 5000,
            resolution: kernelSpec.deadlock.resolution ?? 'abort-lowest',
          }
        : undefined,
      resources: resourceSpec,
      enableMetrics: kernelSpec.enableMetrics ?? false,
    };

    const now = Date.now();
    const agents: AgentDescriptor[] = agentSpecs.map(a => ({
      id: a.id,
      priority: a.priority ?? 'medium',
      group: a.group,
      metadata: a.metadata,
      registeredAt: now,
    }));

    return { name, description, kernelConfig, agents, tasks: taskSpecs };
  }

  private static _kernelConfigToSpec(cfg: KernelConfig): ScenarioKernelSpec {
    return {
      scheduler: cfg.scheduler
        ? {
            strategy: cfg.scheduler.strategy,
            maxConcurrent: cfg.scheduler.maxConcurrent,
            taskTimeout: cfg.scheduler.taskTimeout,
          }
        : undefined,
      deadlock: cfg.deadlock
        ? {
            enabled: cfg.deadlock.enabled,
            interval: cfg.deadlock.interval,
            resolution: cfg.deadlock.resolution,
          }
        : undefined,
      enableMetrics: cfg.enableMetrics,
    };
  }
}
