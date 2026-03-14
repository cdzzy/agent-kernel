// ============================================================
// AgentKernel - Core Type Definitions
// Multi-Agent Traffic Control Layer
// ============================================================

import { EventEmitter } from 'node:events';

// ---- Agent Types ----

export type AgentId = string;
export type ResourceId = string;
export type TaskId = string;

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'suspended' | 'terminated';
export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deadlocked';
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'background';

export const PRIORITY_VALUES: Record<PriorityLevel, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  background: 0,
};

export interface AgentDescriptor {
  id: AgentId;
  priority: PriorityLevel;
  group?: string;
  metadata?: Record<string, unknown>;
  registeredAt: number;
}

// ---- Resource Types ----

export type ResourceType = 'mutex' | 'semaphore' | 'pool' | 'rate-limit';

export type ResourceConfig =
  | { type: 'mutex' }
  | { type: 'semaphore'; permits: number }
  | { type: 'pool'; capacity: number }
  | { type: 'rate-limit'; maxTokens: number; refillRate: number };

export interface ResourceDescriptor {
  id: ResourceId;
  config: ResourceConfig;
  owners: Set<AgentId>;
  waitQueue: WaitEntry[];
  totalAcquires: number;
  totalReleases: number;
}

export interface ResourceHandle {
  id: string;
  resourceId: ResourceId;
  agentId: AgentId;
  acquiredAt: number;
}

export interface WaitEntry {
  agentId: AgentId;
  resolve: (handle: ResourceHandle) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  requestedAt: number;
  effectivePriority: number;
}

// ---- Task / Scheduler Types ----

export type SchedulingStrategy = 'fifo' | 'priority' | 'fair-share' | 'round-robin';

export interface TaskDescriptor<T = unknown> {
  id: TaskId;
  agentId: AgentId;
  name: string;
  resources: ResourceId[];
  handler: () => T | Promise<T>;
  priority: number;
  effectivePriority: number;
  status: TaskStatus;
  submittedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: T;
  error?: Error;
  dependencies: TaskId[];
}

export interface TaskSubmission<T = unknown> {
  name: string;
  resources?: ResourceId[];
  handler: () => T | Promise<T>;
  dependencies?: TaskId[];
  priority?: PriorityLevel;
}

export interface SchedulerConfig {
  strategy: SchedulingStrategy;
  maxConcurrent: number;
  taskTimeout?: number;    // ms, default no timeout
  agingInterval?: number;  // ms, how often to boost starved tasks
  agingBoost?: number;     // priority points per aging tick
}

// ---- Deadlock Detection Types ----

export interface DeadlockCycle {
  agents: AgentId[];
  resources: ResourceId[];
  detectedAt: number;
}

export interface DeadlockConfig {
  enabled: boolean;
  interval: number;            // ms between detection sweeps
  resolution: DeadlockResolution;
}

export type DeadlockResolution =
  | 'abort-lowest'    // abort the lowest-priority agent in the cycle
  | 'abort-youngest'  // abort the most recently submitted task
  | 'notify-only';    // just emit event, let user handle it

// ---- Message Bus Types ----

export type MessagePayload = unknown;

export interface AgentMessage {
  id: string;
  from: AgentId;
  to: AgentId | null; // null = broadcast
  topic?: string;
  payload: MessagePayload;
  timestamp: number;
  replyTo?: string; // message id for request/response
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

// ---- Kernel Configuration ----

export interface KernelConfig {
  scheduler?: Partial<SchedulerConfig>;
  deadlock?: Partial<DeadlockConfig>;
  resources?: Record<ResourceId, ResourceConfig>;
  enableMetrics?: boolean;
}

// ---- Metrics / Events ----

export interface KernelMetrics {
  agents: {
    total: number;
    idle: number;
    running: number;
    waiting: number;
  };
  tasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
  resources: Record<ResourceId, {
    owners: number;
    waitQueue: number;
    totalAcquires: number;
    utilization: number;
  }>;
  deadlocks: {
    detected: number;
    resolved: number;
  };
}

export interface KernelEvents {
  'task:submitted': (task: TaskDescriptor) => void;
  'task:started': (task: TaskDescriptor) => void;
  'task:completed': (task: TaskDescriptor) => void;
  'task:failed': (task: TaskDescriptor) => void;
  'task:cancelled': (task: TaskDescriptor) => void;
  'resource:acquired': (handle: ResourceHandle) => void;
  'resource:released': (handle: ResourceHandle) => void;
  'resource:waiting': (agentId: AgentId, resourceId: ResourceId) => void;
  'deadlock:detected': (cycle: DeadlockCycle) => void;
  'deadlock:resolved': (cycle: DeadlockCycle, abortedAgent: AgentId) => void;
  'agent:registered': (agent: AgentDescriptor) => void;
  'agent:terminated': (agent: AgentDescriptor) => void;
  'agent:status-changed': (agentId: AgentId, oldStatus: AgentStatus, newStatus: AgentStatus) => void;
  'message': (message: AgentMessage) => void;
}

export class TypedEventEmitter extends EventEmitter {
  override emit<K extends keyof KernelEvents>(event: K, ...args: Parameters<KernelEvents[K]>): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof KernelEvents>(event: K, listener: KernelEvents[K]): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override off<K extends keyof KernelEvents>(event: K, listener: KernelEvents[K]): this;
  override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  override once<K extends keyof KernelEvents>(event: K, listener: KernelEvents[K]): this;
  override once(event: string, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }
}
