/**
 * Distributed mode — HTTP cluster nodes for multi-node kernels (Roadmap).
 *
 * Exposes a kernel over HTTP so tasks can be executed on remote machines:
 *
 *   ┌─────────────┐   HTTP    ┌──────────────────┐
 *   │ local kernel │ ────────► │ KernelHttpEndpoint │ ──► remote kernel
 *   └─────────────┘           └──────────────────┘
 *
 * Handlers cannot cross the wire (they are closures), so — like
 * `PersistentTaskQueue` — tasks reference handlers **by name** through a
 * registry that must exist on the REMOTE node.
 *
 * Server side (the remote machine)::
 *
 *   const handlers = new ClusterHandlerRegistry();
 *   handlers.register("fetch-report", async () => fetchReport());
 *
 *   const kernel = new AgentKernel();
 *   kernel.register("worker");
 *
 *   const node = new KernelHttpEndpoint({ kernel, handlers, port: 7900, token: "secret" });
 *   await node.start();     // POST /tasks  GET /tasks/:id  GET /health
 *   ...
 *   await node.stop();
 *
 * Client side (the coordinator)::
 *
 *   const remote = new RemoteKernelClient("http://remote:7900", { token: "secret" });
 *   const { taskId } = await remote.submit({ agentId: "worker", name: "daily", handlerRef: "fetch-report" });
 *   const { status, result } = await remote.waitFor(taskId, { timeoutMs: 30_000 });
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentKernel } from './kernel.js';
import type { HandlerFn } from './persistent-queue.js';
import type { PriorityLevel, ResourceId } from './types.js';

// ── Handler registry ─────────────────────────────────────────────────────

export class ClusterHandlerRegistry {
  private readonly handlers = new Map<string, HandlerFn>();

  register(name: string, fn: HandlerFn): this {
    this.handlers.set(name, fn);
    return this;
  }

  unregister(name: string): boolean {
    return this.handlers.delete(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  get(name: string): HandlerFn | undefined {
    return this.handlers.get(name);
  }

  names(): string[] {
    return [...this.handlers.keys()];
  }
}

// ── Shared types ─────────────────────────────────────────────────────────

export interface ClusterTaskSpec {
  agentId: string;
  name: string;
  handlerRef: string;
  /** Passed to the remote handler when it runs. */
  input?: unknown;
  priority?: PriorityLevel;
  resources?: ResourceId[];
}

export interface ClusterTaskInfo {
  taskId: string;
  status: string;
  result?: unknown;
  error?: { message: string };
}

export interface ClusterClientOptions {
  token?: string;
  timeoutMs?: number;
}

// ── Server ───────────────────────────────────────────────────────────────

export interface KernelHttpEndpointOptions {
  kernel: AgentKernel;
  handlers: ClusterHandlerRegistry;
  host?: string;
  port?: number;            // 0 = ephemeral (default)
  token?: string;           // when set, requests must send Authorization: Bearer <token>
}

export class KernelHttpEndpoint {
  private readonly kernel: AgentKernel;
  private readonly handlers: ClusterHandlerRegistry;
  private readonly host: string;
  private readonly port: number;
  private readonly token?: string;
  private server: http.Server | null = null;

  constructor(options: KernelHttpEndpointOptions) {
    this.kernel = options.kernel;
    this.handlers = options.handlers;
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.token = options.token;
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = http.createServer((req, res) => {
      void this.dispatch(req, res);
    });
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** The actual bound port (after ephemeral allocation). */
  get boundPort(): number {
    if (!this.server) return this.port;
    return (this.server.address() as AddressInfo).port;
  }

  get url(): string {
    return `http://${this.host}:${this.boundPort}`;
  }

  private authorize(req: http.IncomingMessage): boolean {
    if (!this.token) return true;
    const auth = req.headers.authorization ?? '';
    return auth === `Bearer ${this.token}`;
  }

  private async dispatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const send = (status: number, payload: unknown): void => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };

    if (!this.authorize(req)) {
      send(401, { error: 'unauthorized' });
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    try {
      // POST /tasks — submit
      if (req.method === 'POST' && url.pathname === '/tasks') {
        const body = await readBody(req);
        const spec = body as ClusterTaskSpec;
        const handler = this.handlers.get(spec.handlerRef);
        if (!handler) {
          send(400, { error: `unknown handler "${spec.handlerRef}"` });
          return;
        }
        const handlerFn = handler as (input: unknown) => unknown;
        const descriptor = this.kernel.submit(spec.agentId, {
          name: spec.name,
          handler: () => handlerFn(spec.input),
          priority: spec.priority,
          resources: spec.resources,
        });
        send(200, { taskId: descriptor.id });
        return;
      }

      // GET /tasks/:id — status + result
      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
      if (req.method === 'GET' && taskMatch) {
        const task = this.kernel.scheduler.getTask(taskMatch[1]!);
        if (!task) {
          send(404, { error: 'task not found' });
          return;
        }
        send(200, {
          taskId: task.id,
          status: task.status,
          result: task.result,
          error: task.error ? { message: task.error.message } : undefined,
          durationMs: task.completedAt ? (task.completedAt - task.submittedAt) : undefined,
        });
        return;
      }

      // GET /health
      if (req.method === 'GET' && url.pathname === '/health') {
        const metrics = this.kernel.getMetrics();
        send(200, {
          ok: true,
          agents: metrics.agents.total,
          tasks: metrics.tasks,
          handlers: this.handlers.names(),
        });
        return;
      }

      send(404, { error: 'not found' });
    } catch (err) {
      send(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error(`invalid JSON body: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
    req.on('error', reject);
  });
}

// ── Client ───────────────────────────────────────────────────────────────

export class RemoteKernelClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: ClusterClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  /** Submit a task to the remote kernel. The handlerRef must exist remotely. */
  async submit(spec: ClusterTaskSpec): Promise<{ taskId: string }> {
    const { status, data } = await this.request('POST', '/tasks', spec);
    if (status !== 200) {
      throw new Error(`remote submit failed (${status}): ${data?.error ?? 'unknown'}`);
    }
    return { taskId: data.taskId as string };
  }

  /** Fetch a task's current status/result. Returns null when unknown. */
  async getTask(taskId: string): Promise<ClusterTaskInfo | null> {
    const { status, data } = await this.request('GET', `/tasks/${taskId}`);
    if (status === 404) return null;
    if (status !== 200) {
      throw new Error(`remote getTask failed (${status})`);
    }
    return data as ClusterTaskInfo;
  }

  /** Poll until the task completes/fails, then return its info. */
  async waitFor(
    taskId: string,
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<ClusterTaskInfo> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pollMs = options.pollMs ?? 100;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const info = await this.getTask(taskId);
      if (info === null) throw new Error(`remote task ${taskId} not found`);
      if (info.status === 'completed' || info.status === 'failed' || info.status === 'cancelled') {
        return info;
      }
      if (Date.now() > deadline) {
        throw new Error(`remote task ${taskId} did not finish within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  /** Combined submit + wait. */
  async execute(spec: ClusterTaskSpec, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<ClusterTaskInfo> {
    const { taskId } = await this.submit(spec);
    return this.waitFor(taskId, options);
  }

  async health(): Promise<{ ok: boolean; agents: number; handlers: string[] }> {
    const { status, data } = await this.request('GET', '/health');
    if (status !== 200) throw new Error(`remote health failed (${status})`);
    return data;
  }
}
