import { describe, it, expect } from 'vitest';
import { AgentMutex } from '../src/concurrency/mutex.js';
import { AgentSemaphore } from '../src/concurrency/semaphore.js';
import { AgentRWLock } from '../src/concurrency/rw-lock.js';
import { AgentBarrier } from '../src/concurrency/barrier.js';

describe('AgentMutex', () => {
  it('should allow single agent to acquire and release', async () => {
    const mutex = new AgentMutex();
    await mutex.acquire('agent-1');
    expect(mutex.isLocked()).toBe(true);
    expect(mutex.getOwner()).toBe('agent-1');
    mutex.release('agent-1');
    expect(mutex.isLocked()).toBe(false);
  });

  it('should queue second agent until first releases', async () => {
    const mutex = new AgentMutex();
    await mutex.acquire('agent-1');

    let agent2Acquired = false;
    const p2 = mutex.acquire('agent-2').then(() => { agent2Acquired = true; });

    expect(mutex.getWaiters()).toEqual(['agent-2']);
    expect(agent2Acquired).toBe(false);

    mutex.release('agent-1');
    await p2;

    expect(agent2Acquired).toBe(true);
    expect(mutex.getOwner()).toBe('agent-2');
  });

  it('should throw when non-owner releases', async () => {
    const mutex = new AgentMutex();
    await mutex.acquire('agent-1');
    expect(() => mutex.release('agent-2')).toThrow();
  });

  it('should support timeout', async () => {
    const mutex = new AgentMutex();
    await mutex.acquire('agent-1');

    await expect(mutex.acquire('agent-2', 50)).rejects.toThrow(/timeout/);
  });

  it('should cancel all waiters', async () => {
    const mutex = new AgentMutex();
    await mutex.acquire('agent-1');

    const p2 = mutex.acquire('agent-2');
    const p3 = mutex.acquire('agent-3');

    mutex.cancelAll('shutting down');

    await expect(p2).rejects.toThrow(/shutting down/);
    await expect(p3).rejects.toThrow(/shutting down/);
  });
});

describe('AgentSemaphore', () => {
  it('should allow N concurrent holders', async () => {
    const sem = new AgentSemaphore(3);
    await sem.acquire('a1');
    await sem.acquire('a2');
    await sem.acquire('a3');

    expect(sem.available()).toBe(0);
    expect(sem.getOwners().size).toBe(3);
  });

  it('should queue when full', async () => {
    const sem = new AgentSemaphore(2);
    await sem.acquire('a1');
    await sem.acquire('a2');

    let a3Got = false;
    const p3 = sem.acquire('a3').then(() => { a3Got = true; });

    expect(a3Got).toBe(false);
    sem.release('a1');
    await p3;
    expect(a3Got).toBe(true);
  });

  it('should throw when releasing more than held', async () => {
    const sem = new AgentSemaphore(3);
    await sem.acquire('a1', 2);
    expect(() => sem.release('a1', 3)).toThrow();
  });

  it('should support timeout', async () => {
    const sem = new AgentSemaphore(1);
    await sem.acquire('a1');
    await expect(sem.acquire('a2', 1, 50)).rejects.toThrow(/timeout/);
  });
});

describe('AgentRWLock', () => {
  it('should allow multiple concurrent readers', async () => {
    const lock = new AgentRWLock();
    await lock.acquireRead('r1');
    await lock.acquireRead('r2');
    await lock.acquireRead('r3');

    expect(lock.getReaders()).toHaveLength(3);
    expect(lock.isReadLocked()).toBe(true);
    expect(lock.isWriteLocked()).toBe(false);
  });

  it('should block writer when readers active', async () => {
    const lock = new AgentRWLock();
    await lock.acquireRead('r1');

    let writerGot = false;
    const pw = lock.acquireWrite('w1').then(() => { writerGot = true; });

    expect(writerGot).toBe(false);
    lock.releaseRead('r1');
    await pw;
    expect(writerGot).toBe(true);
    expect(lock.getWriter()).toBe('w1');
  });

  it('should block readers when writer active', async () => {
    const lock = new AgentRWLock();
    await lock.acquireWrite('w1');

    let readerGot = false;
    const pr = lock.acquireRead('r1').then(() => { readerGot = true; });

    expect(readerGot).toBe(false);
    lock.releaseWrite('w1');
    await pr;
    expect(readerGot).toBe(true);
  });

  it('should throw when releasing without holding', () => {
    const lock = new AgentRWLock();
    expect(() => lock.releaseRead('nobody')).toThrow();
    expect(() => lock.releaseWrite('nobody')).toThrow();
  });
});

describe('AgentBarrier', () => {
  it('should release all when all parties arrive', async () => {
    const barrier = new AgentBarrier(3);
    const results: number[] = [];

    const p1 = barrier.wait('a1').then((gen) => results.push(gen));
    const p2 = barrier.wait('a2').then((gen) => results.push(gen));

    expect(barrier.getArrived()).toBe(2);
    expect(barrier.getWaiting()).toBe(2);

    const p3 = barrier.wait('a3').then((gen) => results.push(gen));
    await Promise.all([p1, p2, p3]);

    expect(results).toHaveLength(3);
    expect(results.every((g) => g === 0)).toBe(true);
    expect(barrier.getGeneration()).toBe(1);
  });

  it('should throw on duplicate arrival', async () => {
    const barrier = new AgentBarrier(3);
    await expect(async () => {
      barrier.wait('a1'); // don't await
      await barrier.wait('a1');
    }).rejects.toThrow(/already arrived/);
  });

  it('should support timeout', async () => {
    const barrier = new AgentBarrier(3);
    await expect(barrier.wait('a1', 50)).rejects.toThrow(/timeout/);
  });

  it('should reset and reject waiters', async () => {
    const barrier = new AgentBarrier(3);
    const p1 = barrier.wait('a1');
    barrier.reset('cancelled');
    await expect(p1).rejects.toThrow(/cancelled/);
  });
});
