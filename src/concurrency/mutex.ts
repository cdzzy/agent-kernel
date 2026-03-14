import type { AgentId } from '../types.js';

/**
 * Agent-aware Mutex — exclusive lock.
 * Only one agent can hold the lock at a time. Others wait in FIFO order.
 */
export class AgentMutex {
  private owner: AgentId | null = null;
  private queue: Array<{
    agentId: AgentId;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  async acquire(agentId: AgentId, timeoutMs?: number): Promise<void> {
    if (this.owner === null) {
      this.owner = agentId;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const entry = { agentId, resolve, reject };
      this.queue.push(entry);

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(new Error(`Mutex acquire timeout for agent "${agentId}" after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        const origResolve = entry.resolve;
        entry.resolve = () => { clearTimeout(timer); origResolve(); };
      }
    });
  }

  release(agentId: AgentId): void {
    if (this.owner !== agentId) {
      throw new Error(`Agent "${agentId}" does not hold this mutex (owner: "${this.owner}")`);
    }

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.owner = next.agentId;
      next.resolve();
    } else {
      this.owner = null;
    }
  }

  getOwner(): AgentId | null {
    return this.owner;
  }

  getWaiters(): AgentId[] {
    return this.queue.map((e) => e.agentId);
  }

  isLocked(): boolean {
    return this.owner !== null;
  }

  cancelAll(reason?: string): void {
    const err = new Error(reason ?? 'Mutex cancelled');
    for (const entry of this.queue) {
      entry.reject(err);
    }
    this.queue = [];
  }
}
