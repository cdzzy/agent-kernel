/**
 * Workflow Engine for agent-kernel
 * 
 * Provides pipeline and DAG (Directed Acyclic Graph) workflow execution
 * for coordinating multiple agent tasks in sequence or parallel.
 * 
 * Reference: Inspired by learn-claude-code workflow patterns and modern
 * agent orchestration frameworks.
 * 
 * Usage:
 *   const workflow = new Workflow(kernel)
 *     .step('research', { agentId: 'researcher', input: 'AI trends' })
 *     .step('write', { agentId: 'writer', dependsOn: ['research'] })
 *     .step('review', { agentId: 'reviewer', dependsOn: ['write'] });
 *   
 *   const result = await workflow.execute();
 */

import { Kernel } from './kernel';
import { Priority } from './types';

export type StepId = string;

export interface WorkflowStep {
  id: StepId;
  agentId: string;
  input?: any;
  priority?: Priority;
  resources?: string[];
  dependsOn?: StepId[];
  timeout?: number;
  retries?: number;
  condition?: (results: WorkflowResults) => boolean;
  transform?: (result: any, results: WorkflowResults) => any;
}

export interface WorkflowResults {
  [stepId: StepId]: {
    output: any;
    status: 'success' | 'failed' | 'skipped';
    durationMs: number;
    error?: Error;
  };
}

export interface WorkflowOptions {
  name?: string;
  maxConcurrency?: number;
  onStepComplete?: (stepId: StepId, result: any) => void;
  onStepError?: (stepId: StepId, error: Error) => void;
}

export class Workflow {
  private steps: Map<StepId, WorkflowStep> = new Map();
  private kernel: Kernel;
  private options: WorkflowOptions;

  constructor(kernel: Kernel, options: WorkflowOptions = {}) {
    this.kernel = kernel;
    this.options = {
      maxConcurrency: 5,
      ...options,
    };
  }

  /**
   * Add a step to the workflow
   */
  step(id: StepId, config: Omit<WorkflowStep, 'id'>): this {
    this.steps.set(id, { id, ...config });
    return this;
  }

  /**
   * Add a parallel step group (all steps run concurrently)
   */
  parallel(id: StepId, subSteps: Omit<WorkflowStep, 'id'>[]): this {
    for (let i = 0; i < subSteps.length; i++) {
      const subId = `${id}_${i}`;
      this.steps.set(subId, { id: subId, ...subSteps[i] });
    }
    return this;
  }

  /**
   * Build dependency graph and validate
   */
  private buildDependencyGraph(): Map<StepId, Set<StepId>> {
    const graph = new Map<StepId, Set<StepId>>();
    
    // Initialize
    for (const [id] of this.steps) {
      graph.set(id, new Set());
    }

    // Add edges
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

    // Detect cycles
    this.detectCycle(graph);

    return graph;
  }

  /**
   * Detect cycles in dependency graph using DFS
   */
  private detectCycle(graph: Map<StepId, Set<StepId>>): void {
    const visited = new Set<StepId>();
    const recStack = new Set<StepId>();

    const dfs = (node: StepId): boolean => {
      visited.add(node);
      recStack.add(node);

      for (const neighbor of graph.get(node) || []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          throw new Error(`Cycle detected in workflow: ${neighbor} -> ${node}`);
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const [node] of graph) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
  }

  /**
   * Get steps that are ready to execute (all dependencies satisfied)
   */
  private getReadySteps(
    graph: Map<StepId, Set<StepId>>,
    completed: Set<StepId>,
    inProgress: Set<StepId>
  ): StepId[] {
    const ready: StepId[] = [];

    for (const [id, deps] of graph) {
      if (completed.has(id) || inProgress.has(id)) continue;
      
      const allDepsSatisfied = Array.from(deps).every(dep => completed.has(dep));
      if (allDepsSatisfied) {
        ready.push(id);
      }
    }

    return ready;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: WorkflowStep,
    results: WorkflowResults
  ): Promise<{ output: any; durationMs: number; error?: Error }> {
    const startTime = Date.now();
    
    try {
      // Check condition
      if (step.condition && !step.condition(results)) {
        return {
          output: null,
          durationMs: Date.now() - startTime,
        };
      }

      // Prepare input (transform if needed)
      let input = step.input;
      if (step.transform && step.dependsOn) {
        const parentResult = step.dependsOn.length > 0 
          ? results[step.dependsOn[step.dependsOn.length - 1]]?.output 
          : undefined;
        input = step.transform(parentResult, results);
      }

      // Schedule task on kernel
      const taskId = await this.kernel.schedule({
        agentId: step.agentId,
        priority: step.priority || 'NORMAL',
        resources: step.resources || [],
        run: async (ctx) => {
          // The actual agent execution would happen here
          // For now, we pass through the input
          return { result: input };
        },
      });

      const output = await this.kernel.waitFor(taskId);
      const durationMs = Date.now() - startTime;

      this.options.onStepComplete?.(step.id, output);

      return { output, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.options.onStepError?.(step.id, error as Error);
      
      if (step.retries && step.retries > 0) {
        // Retry logic would go here
        console.log(`Retrying step ${step.id} (${step.retries} retries left)`);
      }

      return {
        output: null,
        durationMs,
        error: error as Error,
      };
    }
  }

  /**
   * Execute the workflow
   */
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

      // Execute ready steps (up to maxConcurrency)
      const toExecute = ready.slice(0, this.options.maxConcurrency! - inProgress.size);
      
      const promises = toExecute.map(async (stepId) => {
        inProgress.add(stepId);
        const step = this.steps.get(stepId)!;
        
        const { output, durationMs, error } = await this.executeStep(step, results);
        
        results[stepId] = {
          output,
          status: error ? 'failed' : 'success',
          durationMs,
          error,
        };

        inProgress.delete(stepId);
        completed.add(stepId);
      });

      await Promise.all(promises);
    }

    return results;
  }

  /**
   * Get workflow visualization (for debugging)
   */
  visualize(): string {
    const lines: string[] = ['Workflow: ' + (this.options.name || 'unnamed')];
    
    for (const [id, step] of this.steps) {
      const deps = step.dependsOn?.join(', ') || 'none';
      lines.push(`  [${id}] -> agent: ${step.agentId}, deps: [${deps}]`);
    }

    return lines.join('\n');
  }
}

/**
 * Pipeline - Linear workflow where each step feeds into the next
 */
export class Pipeline extends Workflow {
  private lastStepId: StepId | null = null;
  private stepCounter = 0;

  constructor(kernel: Kernel, options: WorkflowOptions = {}) {
    super(kernel, options);
  }

  /**
   * Add a step to the pipeline
   */
  pipe(agentId: string, config: Omit<WorkflowStep, 'id' | 'agentId' | 'dependsOn'> = {}): this {
    const id = `step_${this.stepCounter++}`;
    const stepConfig: WorkflowStep = {
      id,
      agentId,
      ...config,
    };

    if (this.lastStepId) {
      stepConfig.dependsOn = [this.lastStepId];
    }

    this.steps.set(id, stepConfig);
    this.lastStepId = id;
    return this;
  }
}

/**
 * Create a simple sequential workflow
 */
export function createPipeline(
  kernel: Kernel,
  steps: Array<{ agentId: string; input?: any }>,
  options: WorkflowOptions = {}
): Workflow {
  const pipeline = new Pipeline(kernel, options);
  
  for (const step of steps) {
    pipeline.pipe(step.agentId, { input: step.input });
  }

  return pipeline;
}

/**
 * Create a parallel workflow (all steps run concurrently)
 */
export function createParallelWorkflow(
  kernel: Kernel,
  steps: Array<{ id: string; agentId: string; input?: any }>,
  options: WorkflowOptions = {}
): Workflow {
  const workflow = new Workflow(kernel, options);
  
  for (const step of steps) {
    workflow.step(step.id, {
      agentId: step.agentId,
      input: step.input,
    });
  }

  return workflow;
}
