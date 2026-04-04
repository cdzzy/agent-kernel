import type { AgentId } from '../types.js';

/**
 * Agent-aware Barrier — synchronization point.
 * All registered agents must arrive before any can proceed.
 */
export class AgentBarrier {
  private parties: number;
  private arrived = new Set<AgentId>();
  private waiters: Array<{ agentId: AgentId; resolve: () => void; reject: (err: Error) => void }> = [];
  private generation = 0;

  constructor(parties: number) {
    if (parties < 1) throw new Error('Barrier parties must be >= 1');
    this.parties = parties;
  }

  async wait(agentId: AgentId, timeoutMs?: number): Promise<number> {
    if (this.arrived.has(agentId)) {
      throw new Error(`Agent "${agentId}" already arrived at barrier`);
    }

    this.arrived.add(agentId);
    const gen = this.generation;

    if (this.arrived.size >= this.parties) {
      // All arrived — release everyone
      const currentGen = this.generation;
      this.generation++;
      this.arrived.clear();

      for (const w of this.waiters) {
        w.resolve();
      }
      this.waiters = [];
      return currentGen;
    }

    return new Promise<number>((resolve, reject) => {
      const entry = {
        agentId,
        resolve: () => resolve(gen),
        reject,
      };
      this.waiters.push(entry);

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          const idx = this.waiters.indexOf(entry);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
            this.arrived.delete(agentId);
            reject(new Error(`Barrier wait timeout for agent "${agentId}"`));
          }
        }, timeoutMs);
        const origResolve = entry.resolve;
        entry.resolve = () => { clearTimeout(timer); origResolve(); };
      }
    });
  }

  getParties(): number {
    return this.parties;
  }

  getArrived(): number {
    return this.arrived.size;
  }

  getWaiting(): number {
    return this.waiters.length;
  }

  getGeneration(): number {
    return this.generation;
  }

  reset(reason?: string): void {
    const err = new Error(reason ?? 'Barrier reset');
    for (const w of this.waiters) {
      w.reject(err);
    }
    this.waiters = [];
    this.arrived.clear();
  }
}
