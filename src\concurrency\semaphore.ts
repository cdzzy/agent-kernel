import type { AgentId } from '../types.js';

/**
 * Agent-aware Semaphore — counted concurrent access.
 * Up to N agents can hold permits simultaneously.
 */
export class AgentSemaphore {
  private permits: number;
  private readonly maxPermits: number;
  private owners = new Map<AgentId, number>(); // agentId -> permit count
  private queue: Array<{
    agentId: AgentId;
    count: number;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(permits: number) {
    if (permits < 1) throw new Error('Semaphore permits must be >= 1');
    this.permits = permits;
    this.maxPermits = permits;
  }

  async acquire(agentId: AgentId, count = 1, timeoutMs?: number): Promise<void> {
    if (count < 1 || count > this.maxPermits) {
      throw new Error(`Invalid permit count: ${count} (max: ${this.maxPermits})`);
    }

    if (this.permits >= count) {
      this.permits -= count;
      this.owners.set(agentId, (this.owners.get(agentId) ?? 0) + count);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const entry = { agentId, count, resolve, reject };
      this.queue.push(entry);

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(new Error(`Semaphore acquire timeout for agent "${agentId}" after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        const origResolve = entry.resolve;
        entry.resolve = () => { clearTimeout(timer); origResolve(); };
      }
    });
  }

  release(agentId: AgentId, count = 1): void {
    const held = this.owners.get(agentId) ?? 0;
    if (held < count) {
      throw new Error(`Agent "${agentId}" holds ${held} permits but tried to release ${count}`);
    }

    if (held === count) {
      this.owners.delete(agentId);
    } else {
      this.owners.set(agentId, held - count);
    }

    this.permits += count;
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.permits >= this.queue[0].count) {
      const next = this.queue.shift()!;
      this.permits -= next.count;
      this.owners.set(next.agentId, (this.owners.get(next.agentId) ?? 0) + next.count);
      next.resolve();
    }
  }

  available(): number {
    return this.permits;
  }

  getOwners(): Map<AgentId, number> {
    return new Map(this.owners);
  }

  getWaiters(): AgentId[] {
    return this.queue.map((e) => e.agentId);
  }

  cancelAll(reason?: string): void {
    const err = new Error(reason ?? 'Semaphore cancelled');
    for (const entry of this.queue) {
      entry.reject(err);
    }
    this.queue = [];
  }
}
