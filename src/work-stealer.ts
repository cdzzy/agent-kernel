/**
 * Work-stealing scheduler for load balancing (Roadmap).
 *
 * Classic work-stealing (BLAS-style): each worker drains its own queue from
 * one end; idle workers steal from the OPPOSITE end of the busiest victim's
 * queue, minimizing contention. Stolen work is re-submitted through the
 * AgentKernel so scheduling, priorities, and resource limits still apply.
 *
 * Usage::
 *   const pool = new WorkStealingPool({ stealThreshold: 2 });
 *   pool.registerWorker("worker-1");
 *   pool.registerWorker("worker-2");
 *
 *   pool.enqueue("worker-1", { name: "job-a", run: async () => ... });
 *   pool.enqueue("worker-1", { name: "job-b", run: async () => ... });
 *
 *   const stolen = pool.stealFor("worker-2");   // manual steal
 *   const moved = pool.rebalance(kernel);       // push stolen work through the kernel
 */

import type { AgentId } from './types.js';
import type { AgentKernel } from './kernel.js';

export interface WorkStealingConfig {
  /** Victim must hold more than this many queued tasks to be stealable (default 1). */
  stealThreshold?: number;
  /** Max tasks moved per rebalance per idle worker (default 1). */
  maxSteal?: number;
  /** Auto-rebalance interval in ms (0 = manual only, default 0). */
  interval?: number;
}

export interface PendingTask<T = unknown> {
  name: string;
  owner: AgentId;
  run: () => T | Promise<T>;
  enqueuedAt: number;
}

export interface PoolStats {
  workers: number;
  queuedByWorker: Record<AgentId, number>;
  totalQueued: number;
  stolen: number;
}

export interface StealResult<T = unknown> {
  task: PendingTask<T> | null;
  victim: AgentId | null;
}

const DEFAULT_CONFIG: Required<WorkStealingConfig> = {
  stealThreshold: 1,
  maxSteal: 1,
  interval: 0,
};

export class WorkStealingPool {
  private readonly config: Required<WorkStealingConfig>;
  private readonly queues = new Map<AgentId, PendingTask[]>();
  private stolenCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: WorkStealingConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a worker with its own local queue. */
  registerWorker(agentId: AgentId): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
  }

  unregisterWorker(agentId: AgentId): void {
    this.queues.delete(agentId);
  }

  listWorkers(): AgentId[] {
    return [...this.queues.keys()];
  }

  /** Enqueue a task onto its owner's local queue (owner must be registered). */
  enqueue<T>(agentId: AgentId, task: { name: string; run: () => T | Promise<T> }): PendingTask<T> {
    const queue = this.queues.get(agentId);
    if (!queue) throw new Error(`Worker "${agentId}" is not registered`);
    const pending: PendingTask<T> = {
      name: task.name,
      owner: agentId,
      run: task.run,
      enqueuedAt: Date.now(),
    };
    queue.push(pending as PendingTask);
    return pending;
  }

  /**
   * Steal a task for an (typically idle) worker.
   *
   * The victim is the OTHER worker with the most queued tasks (above the
   * threshold); the task is taken from the victim's queue in FIFO order
   * (oldest first — stealing from the "other end" of the victim's LIFO
   * consumption order, per the classic work-stealing contract).
   */
  stealFor<T = unknown>(thiefId: AgentId): StealResult<T> {
    if (!this.queues.has(thiefId)) {
      throw new Error(`Worker "${thiefId}" is not registered`);
    }

    let victim: AgentId | null = null;
    let victimQueue: PendingTask[] | null = null;

    for (const [workerId, queue] of this.queues) {
      if (workerId === thiefId) continue;
      if (queue.length <= this.config.stealThreshold) continue;
      if (!victimQueue || queue.length > victimQueue.length) {
        victim = workerId;
        victimQueue = queue;
      }
    }

    if (!victim || !victimQueue || victimQueue.length === 0) {
      return { task: null, victim: null };
    }

    const task = victimQueue.shift()!;
    task.owner = thiefId;   // ownership transfers to the thief
    this.stolenCount += 1;
    return { task: task as PendingTask<T>, victim };
  }

  /**
   * Rebalance: for every idle worker (empty local queue), steal work and
   * submit it through the kernel so the thief executes it under normal
   * scheduling semantics. Returns the number of tasks moved.
   */
  async rebalance(kernel: AgentKernel): Promise<number> {
    let moved = 0;
    for (const workerId of this.listWorkers()) {
      const queue = this.queues.get(workerId)!;
      if (queue.length > 0) continue; // worker is busy — leave it alone

      for (let i = 0; i < this.config.maxSteal; i++) {
        const { task } = this.stealFor(workerId);
        if (!task) break;
        kernel.submit(workerId, {
          name: task.name,
          handler: task.run,
        });
        moved += 1;
      }
    }
    return moved;
  }

  /** Start automatic periodic rebalancing (no-op when interval is 0). */
  startAutoRebalance(kernel: AgentKernel): void {
    if (this.timer || this.config.interval <= 0) return;
    this.timer = setInterval(() => {
      void this.rebalance(kernel);
    }, this.config.interval);
  }

  stopAutoRebalance(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stats(): PoolStats {
    const queuedByWorker: Record<AgentId, number> = {};
    let total = 0;
    for (const [workerId, queue] of this.queues) {
      queuedByWorker[workerId] = queue.length;
      total += queue.length;
    }
    return {
      workers: this.queues.size,
      queuedByWorker,
      totalQueued: total,
      stolen: this.stolenCount,
    };
  }
}
