/**
 * Persistent task queue — survive kernel restarts (Roadmap).
 *
 * Write-ahead journals every submission to a JSONL file and re-submits tasks
 * that never settled when a fresh kernel comes up. Handlers are closures and
 * cannot be serialized, so journaled tasks reference handlers by *name* via a
 * registry (`registerHandler`).
 *
 * Semantics: **at-least-once**. A task that was mid-flight during a crash is
 * re-run on recovery.
 *
 * Journal records:
 *   { kind: "submit",  refId, task }   — written BEFORE the task runs
 *   { kind: "started", refId, taskId } — links the ref to its kernel task id
 *   { kind: "settled", refId, status } — task reached a terminal state
 *
 * Usage::
 *   const queue = new PersistentTaskQueue("kernel-journal.jsonl");
 *   queue.registerHandler("fetch-report", async () => fetchReport());
 *
 *   await queue.recover(kernel);          // re-submit anything unfinished
 *   queue.submit(kernel, "worker-1", {
 *     name: "daily-report",
 *     handlerRef: "fetch-report",
 *   });
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentId, PriorityLevel, ResourceId, TaskDescriptor, TaskId } from './types.js';
import type { AgentKernel } from './kernel.js';

export type HandlerFn = () => unknown | Promise<unknown>;

export interface JournaledTask {
  agentId: AgentId;
  name: string;
  handlerRef: string;
  priority?: PriorityLevel;
  resources?: ResourceId[];
  dependencies?: TaskId[];
}

export type JournalEntry =
  | { kind: 'submit'; at: number; refId: string; task: JournaledTask }
  | { kind: 'started'; at: number; refId: string; taskId: TaskId }
  | { kind: 'settled'; at: number; refId: string; status: string };

export interface RecoveryResult {
  resubmitted: number;
  skipped: number;
}

export interface PersistentQueueOptions {
  /** Also recover tasks that FAILED before the crash (default: false). */
  recoverFailed?: boolean;
}

export interface QueueSubmitSpec {
  name: string;
  handlerRef: string;
  priority?: PriorityLevel;
  resources?: ResourceId[];
  dependencies?: TaskId[];
}

export class PersistentTaskQueue {
  private readonly path: string;
  private readonly options: Required<PersistentQueueOptions>;
  private readonly handlers = new Map<string, HandlerFn>();
  /** kernel task id → journal refId (for live settle tracking). */
  private readonly liveLinks = new Map<TaskId, string>();

  constructor(path: string, options: PersistentQueueOptions = {}) {
    this.path = path;
    this.options = { recoverFailed: options.recoverFailed ?? false };
  }

  // ── Handler registry ────────────────────────────────────────────────────

  /** Register a named handler that journaled tasks can reference. */
  registerHandler(name: string, fn: HandlerFn): this {
    this.handlers.set(name, fn);
    return this;
  }

  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  // ── Journal I/O ─────────────────────────────────────────────────────────

  private append(entry: JournalEntry): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.appendFileSync(this.path, JSON.stringify(entry) + '\n', 'utf-8');
  }

  /** Read all journal entries; corrupt lines (torn writes) are skipped. */
  read(): JournalEntry[] {
    if (!fs.existsSync(this.path)) return [];
    const entries: JournalEntry[] = [];
    for (const line of fs.readFileSync(this.path, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as JournalEntry);
      } catch {
        // Skip corrupt lines
      }
    }
    return entries;
  }

  /** Rewrite the journal keeping only unfinished submissions. Returns remaining count. */
  compact(): number {
    const { refs, settledRefs } = this.analyze(this.read());
    const pending = refs.filter((r) => !settledRefs.has(r.refId));
    const tmp = this.path + '.tmp';
    fs.writeFileSync(
      tmp,
      pending.map((r) => JSON.stringify({ kind: 'submit', at: r.at, refId: r.refId, task: r.task })).join('\n') +
        (pending.length ? '\n' : ''),
      'utf-8',
    );
    fs.renameSync(tmp, this.path);
    return pending.length;
  }

  // ── Submission ──────────────────────────────────────────────────────────

  /**
   * Journal-then-submit: the submission is persisted BEFORE the task runs, so
   * a crash between journaling and completion is recovered (at-least-once).
   */
  submit(kernel: AgentKernel, agentId: AgentId, spec: QueueSubmitSpec): TaskDescriptor {
    const handler = this.handlers.get(spec.handlerRef);
    if (!handler) {
      throw new Error(
        `Unknown handler "${spec.handlerRef}". Register it first: queue.registerHandler("${spec.handlerRef}", fn)`,
      );
    }

    this.track(kernel);

    const refId = randomUUID();
    const task: JournaledTask = {
      agentId,
      name: spec.name,
      handlerRef: spec.handlerRef,
      priority: spec.priority,
      resources: spec.resources,
      dependencies: spec.dependencies,
    };

    this.append({ kind: 'submit', at: Date.now(), refId, task });
    const descriptor = kernel.submit(agentId, {
      name: spec.name,
      handler: handler as () => unknown,
      priority: spec.priority,
      resources: spec.resources,
      dependencies: spec.dependencies,
    });
    this.append({ kind: 'started', at: Date.now(), refId, taskId: descriptor.id });
    this.liveLinks.set(descriptor.id, refId);

    return descriptor;
  }

  /** Listen for settled tasks so the journal marks them done. Idempotent per kernel. */
  track(kernel: AgentKernel): void {
    const settle = (taskId: TaskId, status: string) => {
      const refId = this.liveLinks.get(taskId);
      if (refId) this.append({ kind: 'settled', at: Date.now(), refId, status });
    };
    kernel.on('task:completed', (task) => settle(task.id, 'completed'));
    kernel.on('task:failed', (task) => settle(task.id, 'failed'));
    kernel.on('task:cancelled', (task) => settle(task.id, 'cancelled'));
  }

  // ── Recovery ────────────────────────────────────────────────────────────

  private analyze(entries: JournalEntry[]): {
    refs: Array<{ refId: string; at: number; task: JournaledTask }>;
    links: Map<TaskId, string>;
    settledRefs: Set<string>;
    failedRefs: Set<string>;
  } {
    const refs: Array<{ refId: string; at: number; task: JournaledTask }> = [];
    const links = new Map<TaskId, string>();
    const settledRefs = new Set<string>();
    const failedRefs = new Set<string>();

    for (const entry of entries) {
      if (entry.kind === 'submit') {
        refs.push({ refId: entry.refId, at: entry.at, task: entry.task });
      } else if (entry.kind === 'started') {
        links.set(entry.taskId, entry.refId);
      } else if (entry.kind === 'settled') {
        settledRefs.add(entry.refId);
        if (entry.status === 'failed') failedRefs.add(entry.refId);
      }
    }
    return { refs, links, settledRefs, failedRefs };
  }

  /**
   * Re-submit unfinished tasks into a fresh kernel, in journal order.
   *
   * - Tasks whose handler is not registered are skipped (counted).
   * - Dependencies are remapped: a dependency on a task that settled is
   *   dropped (satisfied); a dependency on a task that is itself being
   *   recovered is remapped to the recovered task's new id.
   * - Failed tasks are not recovered unless `recoverFailed` is set.
   */
  async recover(kernel: AgentKernel): Promise<RecoveryResult> {
    this.track(kernel);
    const { refs, links, settledRefs, failedRefs } = this.analyze(this.read());

    const unrecoverable = new Set(settledRefs);
    if (this.options.recoverFailed) {
      for (const refId of failedRefs) unrecoverable.delete(refId);
    }

    const remap = new Map<TaskId, TaskId>(); // old kernel taskId → new taskId
    let resubmitted = 0;
    let skipped = 0;

    for (const ref of refs) {
      if (unrecoverable.has(ref.refId)) continue;

      const task = ref.task;
      const handler = this.handlers.get(task.handlerRef);
      if (!handler) {
        skipped += 1;
        continue;
      }

      // Remap dependencies: old dep id → new id if the dep was recovered in
      // this pass; deps that settled are satisfied (dropped); deps whose
      // original task failed/cancelled are dropped (they will never complete).
      const dependencies = (task.dependencies ?? [])
        .map((depId) => remap.get(depId))
        .filter((depId): depId is TaskId => depId !== undefined);

      const descriptor = kernel.submit(task.agentId, {
        name: task.name,
        handler: handler as () => unknown,
        priority: task.priority,
        resources: task.resources,
        dependencies,
      });

      // Keep the old→new id mapping if we know the old id, so later
      // dependencies in the journal can be remapped.
      for (const [oldTaskId, refId] of links) {
        if (refId === ref.refId) {
          remap.set(oldTaskId, descriptor.id);
          break;
        }
      }

      this.append({ kind: 'started', at: Date.now(), refId: ref.refId, taskId: descriptor.id });
      resubmitted += 1;
    }

    return { resubmitted, skipped };
  }
}
