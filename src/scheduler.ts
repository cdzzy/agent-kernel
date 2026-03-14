import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  TaskId,
  TaskDescriptor,
  TaskSubmission,
  SchedulerConfig,
  SchedulingStrategy,
  TypedEventEmitter,
  PRIORITY_VALUES,
  AgentDescriptor,
} from './types.js';
import { PRIORITY_VALUES as PV } from './types.js';
import type { ResourceManager } from './resource-manager.js';

const DEFAULT_CONFIG: SchedulerConfig = {
  strategy: 'priority',
  maxConcurrent: 10,
  taskTimeout: undefined,
  agingInterval: 5000,
  agingBoost: 5,
};

/**
 * Task Scheduler — orchestrates agent task execution.
 *
 * Strategies:
 * - fifo: first-in first-out
 * - priority: highest effective priority first
 * - fair-share: balance across agent groups
 * - round-robin: cycle through agents equally
 */
export class Scheduler {
  private config: SchedulerConfig;
  private queue: TaskDescriptor[] = [];
  private running = new Map<TaskId, TaskDescriptor>();
  private completed: TaskDescriptor[] = [];
  private agents = new Map<AgentId, AgentDescriptor>();
  private agentTaskCounts = new Map<AgentId, number>(); // for fair-share
  private roundRobinIndex = 0;
  private agingTimer?: ReturnType<typeof setInterval>;
  private processing = false;
  private emitter?: TypedEventEmitter;
  private resourceManager?: ResourceManager;

  constructor(
    config?: Partial<SchedulerConfig>,
    emitter?: TypedEventEmitter,
    resourceManager?: ResourceManager,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.emitter = emitter;
    this.resourceManager = resourceManager;

    if (this.config.agingInterval && this.config.agingBoost) {
      this.agingTimer = setInterval(() => this.applyAging(), this.config.agingInterval);
    }
  }

  registerAgent(agent: AgentDescriptor): void {
    this.agents.set(agent.id, agent);
    this.agentTaskCounts.set(agent.id, 0);
  }

  removeAgent(agentId: AgentId): void {
    this.agents.delete(agentId);
    this.agentTaskCounts.delete(agentId);
  }

  submit<T>(agentId: AgentId, submission: TaskSubmission<T>): TaskDescriptor<T> {
    const agent = this.agents.get(agentId);
    const basePriority = submission.priority
      ? PV[submission.priority]
      : (agent ? PV[agent.priority] : PV.medium);

    const task: TaskDescriptor<T> = {
      id: randomUUID(),
      agentId,
      name: submission.name,
      resources: submission.resources ?? [],
      handler: submission.handler,
      priority: basePriority,
      effectivePriority: basePriority,
      status: 'pending',
      submittedAt: Date.now(),
      dependencies: submission.dependencies ?? [],
    };

    this.queue.push(task as TaskDescriptor);
    task.status = 'queued';

    this.emitter?.emit('task:submitted', task as TaskDescriptor);
    this.scheduleProcessing();

    return task;
  }

  cancel(taskId: TaskId): boolean {
    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx >= 0) {
      const task = this.queue.splice(idx, 1)[0];
      task.status = 'cancelled';
      this.emitter?.emit('task:cancelled', task);
      return true;
    }
    return false;
  }

  getTask(taskId: TaskId): TaskDescriptor | undefined {
    return this.queue.find((t) => t.id === taskId)
      ?? this.running.get(taskId)
      ?? this.completed.find((t) => t.id === taskId);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getRunningCount(): number {
    return this.running.size;
  }

  getStats(): { queued: number; running: number; completed: number; failed: number } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      completed: this.completed.filter((t) => t.status === 'completed').length,
      failed: this.completed.filter((t) => t.status === 'failed').length,
    };
  }

  shutdown(): void {
    if (this.agingTimer) {
      clearInterval(this.agingTimer);
      this.agingTimer = undefined;
    }
  }

  // ---- Scheduling Logic ----

  private scheduleProcessing(): void {
    if (this.processing) return;
    // Use queueMicrotask for immediate but non-reentrant processing
    queueMicrotask(() => this.processQueue());
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && this.running.size < this.config.maxConcurrent) {
        const task = this.selectNext();
        if (!task) break;

        // Check dependencies
        if (!this.dependenciesMet(task)) continue;

        // Remove from queue
        const idx = this.queue.indexOf(task);
        if (idx >= 0) this.queue.splice(idx, 1);

        this.executeTask(task);
      }
    } finally {
      this.processing = false;
    }
  }

  private selectNext(): TaskDescriptor | null {
    const ready = this.queue.filter((t) => this.dependenciesMet(t));
    if (ready.length === 0) return null;

    switch (this.config.strategy) {
      case 'fifo':
        return ready[0];

      case 'priority':
        return ready.reduce((best, t) =>
          t.effectivePriority > best.effectivePriority ? t : best,
        );

      case 'fair-share':
        return this.selectFairShare(ready);

      case 'round-robin':
        return this.selectRoundRobin(ready);

      default:
        return ready[0];
    }
  }

  private selectFairShare(ready: TaskDescriptor[]): TaskDescriptor {
    // Pick the task whose agent has consumed the least resources
    return ready.reduce((best, t) => {
      const bestCount = this.agentTaskCounts.get(best.agentId) ?? 0;
      const tCount = this.agentTaskCounts.get(t.agentId) ?? 0;
      if (tCount < bestCount) return t;
      if (tCount === bestCount && t.effectivePriority > best.effectivePriority) return t;
      return best;
    });
  }

  private selectRoundRobin(ready: TaskDescriptor[]): TaskDescriptor {
    const agentIds = [...new Set(ready.map((t) => t.agentId))];
    if (agentIds.length === 0) return ready[0];

    this.roundRobinIndex = this.roundRobinIndex % agentIds.length;
    const nextAgent = agentIds[this.roundRobinIndex];
    this.roundRobinIndex++;

    return ready.find((t) => t.agentId === nextAgent) ?? ready[0];
  }

  private dependenciesMet(task: TaskDescriptor): boolean {
    for (const depId of task.dependencies) {
      const dep = this.completed.find((t) => t.id === depId);
      if (!dep || dep.status !== 'completed') return false;
    }
    return true;
  }

  private async executeTask(task: TaskDescriptor): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();
    this.running.set(task.id, task);
    this.agentTaskCounts.set(task.agentId, (this.agentTaskCounts.get(task.agentId) ?? 0) + 1);

    this.emitter?.emit('task:started', task);

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        task.handler(),
        ...(this.config.taskTimeout
          ? [new Promise<never>((_, reject) => {
              timeoutTimer = setTimeout(
                () => reject(new Error(`Task "${task.name}" timed out after ${this.config.taskTimeout}ms`)),
                this.config.taskTimeout,
              );
            })]
          : []),
      ]);

      if (timeoutTimer) clearTimeout(timeoutTimer);

      task.result = result;
      task.status = 'completed';
      task.completedAt = Date.now();
      this.emitter?.emit('task:completed', task);
    } catch (err) {
      if (timeoutTimer) clearTimeout(timeoutTimer);

      task.error = err instanceof Error ? err : new Error(String(err));
      task.status = 'failed';
      task.completedAt = Date.now();
      this.emitter?.emit('task:failed', task);
    } finally {
      this.running.delete(task.id);
      this.completed.push(task);

      // Release any resources held
      if (this.resourceManager) {
        this.resourceManager.releaseAll(task.agentId);
      }

      // Continue processing
      this.scheduleProcessing();
    }
  }

  // ---- Priority Aging ----

  private applyAging(): void {
    const now = Date.now();
    const boost = this.config.agingBoost ?? 5;

    for (const task of this.queue) {
      const waitMs = now - task.submittedAt;
      // Boost 1 point per aging interval of waiting
      const agingBoost = Math.floor(waitMs / (this.config.agingInterval ?? 5000)) * boost;
      task.effectivePriority = Math.min(task.priority + agingBoost, 200);
    }
  }

  /** Force a re-sort/re-evaluation (called by PriorityArbiter) */
  updateTaskPriority(taskId: TaskId, newEffectivePriority: number): void {
    const task = this.queue.find((t) => t.id === taskId);
    if (task) {
      task.effectivePriority = newEffectivePriority;
    }
  }

  abortAgentTasks(agentId: AgentId, reason?: string): number {
    let aborted = 0;
    // Cancel queued tasks
    const toRemove = this.queue.filter((t) => t.agentId === agentId);
    for (const task of toRemove) {
      task.status = 'cancelled';
      task.error = new Error(reason ?? `Agent "${agentId}" tasks aborted`);
      this.completed.push(task);
      this.emitter?.emit('task:cancelled', task);
      aborted++;
    }
    this.queue = this.queue.filter((t) => t.agentId !== agentId);
    return aborted;
  }
}
