import type { AgentId } from '../types.js';

/**
 * Agent-aware Read-Write Lock.
 * Multiple agents can hold read locks simultaneously.
 * Write lock is exclusive — no other readers or writers allowed.
 */
export class AgentRWLock {
  private readers = new Set<AgentId>();
  private writer: AgentId | null = null;
  private readQueue: Array<{ agentId: AgentId; resolve: () => void; reject: (err: Error) => void }> = [];
  private writeQueue: Array<{ agentId: AgentId; resolve: () => void; reject: (err: Error) => void }> = [];

  async acquireRead(agentId: AgentId, timeoutMs?: number): Promise<void> {
    if (this.writer === null && this.writeQueue.length === 0) {
      this.readers.add(agentId);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const entry = { agentId, resolve, reject };
      this.readQueue.push(entry);

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          const idx = this.readQueue.indexOf(entry);
          if (idx >= 0) {
            this.readQueue.splice(idx, 1);
            reject(new Error(`RWLock read acquire timeout for agent "${agentId}"`));
          }
        }, timeoutMs);
        const origResolve = entry.resolve;
        entry.resolve = () => { clearTimeout(timer); origResolve(); };
      }
    });
  }

  async acquireWrite(agentId: AgentId, timeoutMs?: number): Promise<void> {
    if (this.writer === null && this.readers.size === 0) {
      this.writer = agentId;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const entry = { agentId, resolve, reject };
      this.writeQueue.push(entry);

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          const idx = this.writeQueue.indexOf(entry);
          if (idx >= 0) {
            this.writeQueue.splice(idx, 1);
            reject(new Error(`RWLock write acquire timeout for agent "${agentId}"`));
          }
        }, timeoutMs);
        const origResolve = entry.resolve;
        entry.resolve = () => { clearTimeout(timer); origResolve(); };
      }
    });
  }

  releaseRead(agentId: AgentId): void {
    if (!this.readers.has(agentId)) {
      throw new Error(`Agent "${agentId}" does not hold a read lock`);
    }
    this.readers.delete(agentId);
    this.tryAdvance();
  }

  releaseWrite(agentId: AgentId): void {
    if (this.writer !== agentId) {
      throw new Error(`Agent "${agentId}" does not hold the write lock`);
    }
    this.writer = null;
    this.tryAdvance();
  }

  private tryAdvance(): void {
    if (this.writer !== null) return;

    // Writers take priority to prevent write starvation
    if (this.readers.size === 0 && this.writeQueue.length > 0) {
      const next = this.writeQueue.shift()!;
      this.writer = next.agentId;
      next.resolve();
      return;
    }

    // If no pending writers, admit all pending readers
    if (this.writeQueue.length === 0) {
      while (this.readQueue.length > 0) {
        const next = this.readQueue.shift()!;
        this.readers.add(next.agentId);
        next.resolve();
      }
    }
  }

  getReaders(): AgentId[] {
    return [...this.readers];
  }

  getWriter(): AgentId | null {
    return this.writer;
  }

  isReadLocked(): boolean {
    return this.readers.size > 0;
  }

  isWriteLocked(): boolean {
    return this.writer !== null;
  }

  cancelAll(reason?: string): void {
    const err = new Error(reason ?? 'RWLock cancelled');
    for (const e of this.readQueue) e.reject(err);
    for (const e of this.writeQueue) e.reject(err);
    this.readQueue = [];
    this.writeQueue = [];
  }
}
