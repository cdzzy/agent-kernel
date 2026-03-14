import type {
  AgentId,
  AgentDescriptor,
  AgentStatus,
  PriorityLevel,
  ResourceId,
  ResourceConfig,
  ResourceHandle,
  TaskId,
  TaskDescriptor,
  TaskSubmission,
  KernelConfig,
  KernelMetrics,
  DeadlockCycle,
  AgentMessage,
  MessageHandler,
  MessagePayload,
} from './types.js';
import { TypedEventEmitter, PRIORITY_VALUES } from './types.js';
import { ResourceManager } from './resource-manager.js';
import { Scheduler } from './scheduler.js';
import { DeadlockDetector } from './deadlock-detector.js';
import { PriorityArbiter } from './priority-arbiter.js';
import { MessageBus } from './message-bus.js';

/**
 * AgentKernel — the "operating system" for multi-agent systems.
 *
 * Provides:
 * - Agent lifecycle management
 * - Task scheduling with multiple strategies
 * - Shared resource management with concurrency primitives
 * - Deadlock detection and resolution
 * - Priority arbitration with aging and inheritance
 * - Inter-agent message passing
 */
export class AgentKernel extends TypedEventEmitter {
  readonly resources: ResourceManager;
  readonly scheduler: Scheduler;
  readonly deadlockDetector: DeadlockDetector;
  readonly arbiter: PriorityArbiter;
  readonly messageBus: MessageBus;

  private agents = new Map<AgentId, AgentEntry>();
  private config: KernelConfig;
  private started = false;

  constructor(config: KernelConfig = {}) {
    super();
    this.config = config;

    // Initialize subsystems
    this.resources = new ResourceManager(config.resources, this);
    this.scheduler = new Scheduler(config.scheduler, this, this.resources);
    this.arbiter = new PriorityArbiter(this.resources);
    this.deadlockDetector = new DeadlockDetector(
      this.resources,
      config.deadlock,
      this,
    );
    this.messageBus = new MessageBus(this);

    // Wire deadlock resolver to scheduler
    this.deadlockDetector.setResolveCallback((agentId) => {
      this.scheduler.abortAgentTasks(agentId, 'Deadlock resolution');
    });
  }

  // ---- Agent Lifecycle ----

  register(agentId: AgentId, options?: {
    priority?: PriorityLevel;
    group?: string;
    metadata?: Record<string, unknown>;
  }): AgentDescriptor {
    if (this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" already registered`);
    }

    const descriptor: AgentDescriptor = {
      id: agentId,
      priority: options?.priority ?? 'medium',
      group: options?.group,
      metadata: options?.metadata,
      registeredAt: Date.now(),
    };

    this.agents.set(agentId, {
      descriptor,
      status: 'idle',
    });

    this.scheduler.registerAgent(descriptor);
    this.arbiter.registerAgent(descriptor);
    this.deadlockDetector.setAgentInfo(
      agentId,
      PRIORITY_VALUES[descriptor.priority],
      descriptor.registeredAt,
    );

    this.emit('agent:registered', descriptor);
    return descriptor;
  }

  terminate(agentId: AgentId): void {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);

    // Clean up
    this.scheduler.abortAgentTasks(agentId);
    this.resources.releaseAll(agentId);
    this.messageBus.unsubscribeAll(agentId);
    this.scheduler.removeAgent(agentId);
    this.arbiter.removeAgent(agentId);

    this.setAgentStatus(agentId, 'terminated');
    this.emit('agent:terminated', entry.descriptor);
    this.agents.delete(agentId);
  }

  getAgent(agentId: AgentId): AgentDescriptor | null {
    return this.agents.get(agentId)?.descriptor ?? null;
  }

  getAgentStatus(agentId: AgentId): AgentStatus | null {
    return this.agents.get(agentId)?.status ?? null;
  }

  listAgents(): AgentDescriptor[] {
    return [...this.agents.values()].map((e) => e.descriptor);
  }

  // ---- Task Submission ----

  submit<T>(agentId: AgentId, task: TaskSubmission<T>): TaskDescriptor<T> {
    this.ensureAgent(agentId);
    this.setAgentStatus(agentId, 'running');
    return this.scheduler.submit(agentId, task);
  }

  cancelTask(taskId: TaskId): boolean {
    return this.scheduler.cancel(taskId);
  }

  // ---- Resource Access ----

  async acquire(agentId: AgentId, resourceId: ResourceId, timeoutMs?: number): Promise<ResourceHandle> {
    this.ensureAgent(agentId);
    this.setAgentStatus(agentId, 'waiting');

    try {
      const handle = await this.resources.acquire(agentId, resourceId, timeoutMs);
      this.setAgentStatus(agentId, 'running');
      return handle;
    } catch (err) {
      this.setAgentStatus(agentId, 'idle');
      throw err;
    }
  }

  release(handle: ResourceHandle): void {
    this.resources.release(handle);
    this.arbiter.resetInheritance(handle.agentId);

    // If agent has no more running tasks, mark idle
    const entry = this.agents.get(handle.agentId);
    if (entry && entry.status === 'running') {
      // Keep running status
    }
  }

  async withResource<T>(
    agentId: AgentId,
    resourceId: ResourceId,
    handler: () => T | Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    const handle = await this.acquire(agentId, resourceId, timeoutMs);
    try {
      return await handler();
    } finally {
      this.release(handle);
    }
  }

  registerResource(resourceId: ResourceId, config: ResourceConfig): void {
    this.resources.register(resourceId, config);
  }

  // ---- Messaging ----

  send(from: AgentId, to: AgentId, payload: MessagePayload, topic?: string): Promise<void> {
    this.ensureAgent(from);
    return this.messageBus.send(from, to, payload, topic);
  }

  publish(from: AgentId, topic: string, payload: MessagePayload): Promise<void> {
    this.ensureAgent(from);
    return this.messageBus.publish(from, topic, payload);
  }

  subscribe(agentId: AgentId, topic: string, handler: MessageHandler): void {
    this.ensureAgent(agentId);
    this.messageBus.subscribe(agentId, topic, handler);
  }

  onMessage(agentId: AgentId, handler: MessageHandler): void {
    this.ensureAgent(agentId);
    this.messageBus.onDirectMessage(agentId, handler);
  }

  request(from: AgentId, to: AgentId, payload: MessagePayload, timeoutMs?: number): Promise<AgentMessage> {
    this.ensureAgent(from);
    return this.messageBus.request(from, to, payload, timeoutMs);
  }

  // ---- Control ----

  start(): void {
    if (this.started) return;
    this.deadlockDetector.start();
    this.started = true;
  }

  shutdown(): void {
    this.deadlockDetector.stop();
    this.scheduler.shutdown();
    this.messageBus.clear();

    for (const [id] of this.agents) {
      this.resources.releaseAll(id);
    }

    this.started = false;
  }

  // ---- Metrics ----

  getMetrics(): KernelMetrics {
    const agents = { total: 0, idle: 0, running: 0, waiting: 0 };
    for (const entry of this.agents.values()) {
      agents.total++;
      if (entry.status === 'idle') agents.idle++;
      if (entry.status === 'running') agents.running++;
      if (entry.status === 'waiting') agents.waiting++;
    }

    const taskStats = this.scheduler.getStats();
    const dlStats = this.deadlockDetector.getStats();

    const resources: KernelMetrics['resources'] = {};
    for (const resId of this.resources.getResourceIds()) {
      const info = this.resources.getResourceInfo(resId);
      if (info) {
        let capacity = 1;
        if (info.config.type === 'semaphore') capacity = info.config.permits;
        else if (info.config.type === 'pool') capacity = info.config.capacity;

        resources[resId] = {
          owners: info.owners.length,
          waitQueue: info.waiters.length,
          totalAcquires: info.totalAcquires,
          utilization: info.owners.length / capacity,
        };
      }
    }

    return {
      agents,
      tasks: {
        total: taskStats.queued + taskStats.running + taskStats.completed + taskStats.failed,
        pending: taskStats.queued,
        running: taskStats.running,
        completed: taskStats.completed,
        failed: taskStats.failed,
      },
      resources,
      deadlocks: dlStats,
    };
  }

  // ---- Internal ----

  private ensureAgent(agentId: AgentId): void {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" not registered`);
    }
  }

  private setAgentStatus(agentId: AgentId, status: AgentStatus): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    const old = entry.status;
    if (old === status) return;
    entry.status = status;
    this.emit('agent:status-changed', agentId, old, status);
  }
}

interface AgentEntry {
  descriptor: AgentDescriptor;
  status: AgentStatus;
}
