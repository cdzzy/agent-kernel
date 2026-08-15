/**
 * Workflow Engine for agent-kernel
 *
 * Provides pipeline and DAG (Directed Acyclic Graph) workflow execution
 * for coordinating multiple agent tasks in sequence or parallel.
 *
 * Usage:
 *   const workflow = new Workflow(kernel)
 *     .step('research', { agentId: 'researcher', input: 'AI trends' })
 *     .step('write', { agentId: 'writer', dependsOn: ['research'] })
 *     .step('review', { agentId: 'reviewer', dependsOn: ['write'] });
 *
 *   const result = await workflow.execute();
 */

import type { AgentKernel } from './kernel.js';
import type { AgentId, TaskId } from './types.js';

export type StepId = string;

export interface WorkflowStep {
  id: StepId;
  agentId: AgentId;
  input?: unknown;
  resources?: string[];
  dependsOn?: StepId[];
  timeout?: number;
  condition?: (results: WorkflowResults) => boolean;
  transform?: (result: unknown, results: WorkflowResults) => unknown;
}

export interface WorkflowResults {
  [stepId: StepId]: {
    output: unknown;
    status: 'success' | 'failed' | 'skipped';
    durationMs: number;
    error?: Error;
  };
}

export interface WorkflowOptions {
  name?: string;
  maxConcurrency?: number;
  onStepComplete?: (stepId: StepId, result: unknown) => void;
  onStepError?: (stepId: StepId, error: Error) => void;
}

export class Workflow {
  protected steps: Map<StepId, WorkflowStep> = new Map();
  private kernel: AgentKernel;
  private options: Required<WorkflowOptions>;

  constructor(kernel: AgentKernel, options: WorkflowOptions = {}) {
    this.kernel = kernel;
    this.options = {
      name: options.name ?? 'workflow',
      maxConcurrency: options.maxConcurrency ?? 5,
      onStepComplete: options.onStepComplete ?? (() => {}),
      onStepError: options.onStepError ?? (() => {}),
    };
  }

  step(id: StepId, config: Omit<WorkflowStep, 'id'>): this {
    this.steps.set(id, { id, ...config });
    return this;
  }

  parallel(id: StepId, subSteps: Omit<WorkflowStep, 'id'>[]): this {
    for (let i = 0; i < subSteps.length; i++) {
      const subId = `${id}_${i}`;
      this.steps.set(subId, { id: subId, ...subSteps[i] });
    }
    return this;
  }

  private buildDependencyGraph(): Map<StepId, Set<StepId>> {
    const graph = new Map<StepId, Set<StepId>>();
    for (const [id] of this.steps) graph.set(id, new Set());
    for (const [id, step] of this.steps) {
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!this.steps.has(depId)) {
            throw new Error(`Step '${id}' depends on unknown step '${depId}'`);
          }
          graph.get(id)!.add(depId);
        }
      }
    }
    this.detectCycle(graph);
    return graph;
  }

  private detectCycle(graph: Map<StepId, Set<StepId>>): void {
    const visited = new Set<StepId>();
    const recStack = new Set<StepId>();
    const dfs = (node: StepId): void => {
      visited.add(node);
      recStack.add(node);
      for (const neighbor of graph.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          throw new Error(`Cycle detected in workflow: ${neighbor} -> ${node}`);
        }
      }
      recStack.delete(node);
    };
    for (const [node] of graph) {
      if (!visited.has(node)) dfs(node);
    }
  }

  private getReadySteps(
    graph: Map<StepId, Set<StepId>>,
    completed: Set<StepId>,
    inProgress: Set<StepId>,
  ): StepId[] {
    const ready: StepId[] = [];
    for (const [id, deps] of graph) {
      if (completed.has(id) || inProgress.has(id)) continue;
      const allDepsSatisfied = Array.from(deps).every((dep) => completed.has(dep));
      if (allDepsSatisfied) ready.push(id);
    }
    return ready;
  }

  private async executeStep(
    step: WorkflowStep,
    results: WorkflowResults,
  ): Promise<{ output: unknown; durationMs: number; error?: Error }> {
    const startTime = Date.now();
    try {
      if (step.condition && !step.condition(results)) {
        return { output: null, durationMs: Date.now() - startTime };
      }

      let input = step.input;
      if (step.transform && step.dependsOn && step.dependsOn.length > 0) {
        const parentResult = results[step.dependsOn[step.dependsOn.length - 1]]?.output;
        input = step.transform(parentResult, results);
      }

      const output = await this.runTask(step, input);
      const durationMs = Date.now() - startTime;
      this.options.onStepComplete(step.id, output);
      return { output, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onStepError(step.id, err);
      return { output: null, durationMs, error: err };
    }
  }

  /** Submit a task to the kernel and resolve when it completes. */
  private runTask(step: WorkflowStep, input: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let taskId: TaskId | undefined;
      const timeoutMs = step.timeout;

      const onCompleted = (task: { id: TaskId; result?: unknown }): void => {
        if (task.id !== taskId) return;
        cleanup();
        resolve(task.result);
      };
      const onFailed = (task: { id: TaskId; error?: Error }): void => {
        if (task.id !== taskId) return;
        cleanup();
        reject(task.error ?? new Error('Task failed'));
      };

      const timer = timeoutMs
        ? setTimeout(() => {
            cleanup();
            reject(new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        this.kernel.off('task:completed', onCompleted as never);
        this.kernel.off('task:failed', onFailed as never);
      };

      this.kernel.on('task:completed', onCompleted as never);
      this.kernel.on('task:failed', onFailed as never);

      try {
        const descriptor = this.kernel.submit(step.agentId, {
          name: step.id,
          resources: step.resources,
          handler: () => input,
        });
        taskId = descriptor.id;
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  async execute(): Promise<WorkflowResults> {
    const graph = this.buildDependencyGraph();
    const results: WorkflowResults = {};
    const completed = new Set<StepId>();
    const inProgress = new Set<StepId>();

    while (completed.size < this.steps.size) {
      const ready = this.getReadySteps(graph, completed, inProgress);
      if (ready.length === 0 && inProgress.size === 0) {
        throw new Error('Workflow deadlock: no steps ready and none in progress');
      }

      const toExecute = ready.slice(0, Math.max(1, this.options.maxConcurrency - inProgress.size));

      const promises = toExecute.map(async (stepId) => {
        inProgress.add(stepId);
        const step = this.steps.get(stepId)!;
        const { output, durationMs, error } = await this.executeStep(step, results);
        results[stepId] = { output, status: error ? 'failed' : 'success', durationMs, error };
        inProgress.delete(stepId);
        completed.add(stepId);
      });

      await Promise.all(promises);
    }

    return results;
  }

  visualize(): string {
    const lines: string[] = ['Workflow: ' + this.options.name];
    for (const [id, step] of this.steps) {
      const deps = step.dependsOn?.join(', ') || 'none';
      lines.push(`  [${id}] -> agent: ${step.agentId}, deps: [${deps}]`);
    }
    return lines.join('\n');
  }
}

export class Pipeline extends Workflow {
  private lastStepId: StepId | null = null;
  private stepCounter = 0;

  pipe(agentId: AgentId, config: Omit<WorkflowStep, 'id' | 'agentId' | 'dependsOn'> = {}): this {
    const id = `step_${this.stepCounter++}`;
    const stepConfig: WorkflowStep = { id, agentId, ...config };
    if (this.lastStepId) {
      stepConfig.dependsOn = [this.lastStepId];
    }
    this.steps.set(id, stepConfig);
    this.lastStepId = id;
    return this;
  }
}

export function createPipeline(
  kernel: AgentKernel,
  steps: Array<{ agentId: AgentId; input?: unknown }>,
  options: WorkflowOptions = {},
): Workflow {
  const pipeline = new Pipeline(kernel, options);
  for (const step of steps) {
    pipeline.pipe(step.agentId, { input: step.input });
  }
  return pipeline;
}

export function createParallelWorkflow(
  kernel: AgentKernel,
  steps: Array<{ id: StepId; agentId: AgentId; input?: unknown }>,
  options: WorkflowOptions = {},
): Workflow {
  const workflow = new Workflow(kernel, options);
  for (const step of steps) {
    workflow.step(step.id, { agentId: step.agentId, input: step.input });
  }
  return workflow;
}
