/**
 * Tests for the persistent task queue (v0.6.0).
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentKernel } from '../src/kernel.js';
import { PersistentTaskQueue } from '../src/persistent-queue.js';

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ak-queue-')), 'journal.jsonl');
}

async function settle(kernel: AgentKernel): Promise<void> {
  // Give the scheduler microtasks + settle listeners a moment
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 10));
    const stats = kernel.getMetrics().tasks;
    if (stats.pending === 0 && stats.running === 0) return;
  }
}

describe('PersistentTaskQueue', () => {
  it('requires registered handlers', () => {
    const queue = new PersistentTaskQueue(tmpFile());
    const kernel = new AgentKernel();
    kernel.register('w');
    expect(() => queue.submit(kernel, 'w', { name: 'x', handlerRef: 'nope' })).toThrow(/Unknown handler/);
  });

  it('journales submit/started/settled for a completed task', async () => {
    const file = tmpFile();
    const queue = new PersistentTaskQueue(file);
    queue.registerHandler('work', async () => 'done');
    const kernel = new AgentKernel();
    kernel.register('w');

    queue.submit(kernel, 'w', { name: 'task-1', handlerRef: 'work' });
    await settle(kernel);

    const entries = queue.read();
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toEqual(['submit', 'started', 'settled']);
    expect(entries[2]!.status).toBe('completed');
  });

  it('recovers an unfinished task after a crash', async () => {
    const file = tmpFile();

    // "Crash" right after journaling the submission (no settled record)
    const crashed = new PersistentTaskQueue(file);
    crashed.registerHandler('work', async () => 'ok');
    const deadKernel = new AgentKernel();
    deadKernel.register('w');
    crashed.submit(deadKernel, 'w', { name: 'lost-task', handlerRef: 'work' });
    // Simulate a crash: no settled record is journaled (kernel never finished)

    // Fresh kernel + queue: recovery re-runs the task
    const ran: string[] = [];
    const fresh = new PersistentTaskQueue(file);
    fresh.registerHandler('work', async () => {
      ran.push('work');
      return 'ok';
    });
    const kernel = new AgentKernel();
    kernel.register('w');
    const { resubmitted, skipped } = await fresh.recover(kernel);

    expect(resubmitted).toBe(1);
    expect(skipped).toBe(0);
    await settle(kernel);
    expect(ran).toEqual(['work']);
  });

  it('does not recover settled tasks', async () => {
    const file = tmpFile();
    const queue = new PersistentTaskQueue(file);
    queue.registerHandler('work', async () => 'ok');
    const kernel = new AgentKernel();
    kernel.register('w');

    queue.submit(kernel, 'w', { name: 'finished', handlerRef: 'work' });
    await settle(kernel);

    const ran = vi.fn();
    const fresh = new PersistentTaskQueue(file);
    fresh.registerHandler('work', async () => ran());
    const { resubmitted } = await fresh.recover(kernel);
    expect(resubmitted).toBe(0);
    expect(ran).not.toHaveBeenCalled();
  });

  it('skips tasks whose handler is no longer registered', async () => {
    const file = tmpFile();
    const queue = new PersistentTaskQueue(file);
    queue.registerHandler('work', async () => 'ok');
    const kernel = new AgentKernel();
    kernel.register('w');
    queue.submit(kernel, 'w', { name: 't', handlerRef: 'work' });
    await settle(kernel);
    // Overwrite the journal with an unsettled submission
    fs.writeFileSync(file, JSON.stringify({ kind: 'submit', at: Date.now(), refId: 'r1', task: { agentId: 'w', name: 't', handlerRef: 'gone' } }) + '\n');

    const fresh = new PersistentTaskQueue(file);
    const { resubmitted, skipped } = await fresh.recover(kernel);
    expect(resubmitted).toBe(0);
    expect(skipped).toBe(1);
  });

  it('drops dependencies on settled tasks during recovery', async () => {
    const file = tmpFile();

    // Step 1: task-1 completes; task-2 (dependent) is submitted but never settles
    const queue = new PersistentTaskQueue(file);
    queue.registerHandler('first', async () => 1);
    queue.registerHandler('second', async () => 2);
    const kernel = new AgentKernel();
    kernel.register('w');

    const t1 = queue.submit(kernel, 'w', { name: 'first', handlerRef: 'first' });
    queue.submit(kernel, 'w', { name: 'second', handlerRef: 'second', dependencies: [t1.id] });
    await settle(kernel);
    // task-2 settled too (kernel ran it) — force a pending journal by compacting
    // against only task-1's settle: emulate a crash where task-2 was queued.
    const entries = queue.read();
    const task2Submit = entries.find((e) => e.kind === 'submit' && e.task?.name === 'second')!;
    fs.writeFileSync(
      file,
      [task2Submit].map((e) => JSON.stringify(e)).join('\n') + '\n',
    );

    // Step 2: fresh kernel — task-2's dependency on the (settled) task-1 must be dropped
    const fresh = new PersistentTaskQueue(file);
    fresh.registerHandler('second', async () => 2);
    const kernel2 = new AgentKernel();
    kernel2.register('w');
    const { resubmitted } = await fresh.recover(kernel2);
    expect(resubmitted).toBe(1);
  });

  it('remaps dependencies between two recovered tasks', async () => {
    const file = tmpFile();

    // Journal two submissions where the second depends on the first's taskId.
    // Simulate: first was started (we know its kernel id), neither settled.
    const queue = new PersistentTaskQueue(file);
    queue.registerHandler('first', async () => 1);
    queue.registerHandler('second', async () => 2);
    const kernel = new AgentKernel();
    kernel.register('w');

    const t1 = queue.submit(kernel, 'w', { name: 'first', handlerRef: 'first' });
    queue.submit(kernel, 'w', { name: 'second', handlerRef: 'second', dependencies: [t1.id] });
    // No settle — emulate crash while both were in flight.

    const ranOrder: string[] = [];
    const fresh = new PersistentTaskQueue(file);
    fresh.registerHandler('first', async () => {
      ranOrder.push('first');
      return 1;
    });
    fresh.registerHandler('second', async () => {
      ranOrder.push('second');
      return 2;
    });
    const kernel2 = new AgentKernel();
    kernel2.register('w');
    const { resubmitted } = await fresh.recover(kernel2);
    expect(resubmitted).toBe(2);
    await settle(kernel2);
    expect(ranOrder).toEqual(['first', 'second']);
  });

  it('recovers failed tasks only when recoverFailed is set', async () => {
    const file = tmpFile();
    const queue = new PersistentTaskQueue(file, { recoverFailed: true });
    queue.registerHandler('flaky', async () => {
      throw new Error('nope');
    });
    const kernel = new AgentKernel();
    kernel.register('w');
    queue.submit(kernel, 'w', { name: 't', handlerRef: 'flaky' });
    await settle(kernel);

    // Default: failed tasks are settled → not recovered
    const strict = new PersistentTaskQueue(file);
    const r1 = await strict.recover(new AgentKernel());
    expect(r1.resubmitted).toBe(0);

    // With recoverFailed: the failed task is re-run (needs the handler registered)
    const ran = vi.fn();
    const lenient = new PersistentTaskQueue(file, { recoverFailed: true });
    lenient.registerHandler('flaky', async () => ran());
    const kernel2 = new AgentKernel();
    kernel2.register('w');
    const r2 = await lenient.recover(kernel2);
    expect(r2.resubmitted).toBe(1);
    await settle(kernel2);
    expect(ran).toHaveBeenCalled();
  });

  it('compact keeps only unfinished submissions', async () => {
    const file = tmpFile();
    const queue = new PersistentTaskQueue(file);
    queue.registerHandler('work', async () => 'ok');
    const kernel = new AgentKernel();
    kernel.register('w');

    queue.submit(kernel, 'w', { name: 'done-task', handlerRef: 'work' });
    await settle(kernel);

    // Manually journal an unfinished submission
    fs.appendFileSync(
      file,
      JSON.stringify({ kind: 'submit', at: Date.now(), refId: 'pending-1', task: { agentId: 'w', name: 'pending', handlerRef: 'work' } }) + '\n',
    );

    const remaining = queue.compact();
    expect(remaining).toBe(1);
    const entries = queue.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('submit');
  });
});
