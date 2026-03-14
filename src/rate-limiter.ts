/**
 * Token Bucket Rate Limiter.
 * Controls the rate at which agents can access a shared resource.
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;
  private queue: Array<{
    count: number;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(maxTokens: number, refillRate: number) {
    if (maxTokens < 1) throw new Error('maxTokens must be >= 1');
    if (refillRate <= 0) throw new Error('refillRate must be > 0');
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  async acquire(count = 1, timeoutMs?: number): Promise<void> {
    if (count > this.maxTokens) {
      throw new Error(`Cannot acquire ${count} tokens (max: ${this.maxTokens})`);
    }

    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const entry = { count, resolve, reject };
      this.queue.push(entry);

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(new Error(`Rate limiter timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        const origResolve = entry.resolve;
        entry.resolve = () => { clearTimeout(timer); origResolve(); };
      }

      // Schedule a drain check after enough time for tokens to refill
      const waitTime = ((count - this.tokens) / this.refillRate) * 1000;
      setTimeout(() => this.tryDrain(), Math.ceil(waitTime));
    });
  }

  tryAcquire(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
    this.tryDrain();
  }

  private tryDrain(): void {
    this.refill_internal();
    while (this.queue.length > 0 && this.tokens >= this.queue[0].count) {
      const next = this.queue.shift()!;
      this.tokens -= next.count;
      next.resolve();
    }
  }

  private refill_internal(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  cancelAll(reason?: string): void {
    const err = new Error(reason ?? 'Rate limiter cancelled');
    for (const entry of this.queue) {
      entry.reject(err);
    }
    this.queue = [];
  }
}
