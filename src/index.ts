// AgentKernel — Multi-Agent Traffic Control Layer

export { AgentKernel } from './kernel.js';
export { ResourceManager } from './resource-manager.js';
export { Scheduler } from './scheduler.js';
export { DeadlockDetector } from './deadlock-detector.js';
export { PriorityArbiter } from './priority-arbiter.js';
export { MessageBus } from './message-bus.js';
export { RateLimiter } from './rate-limiter.js';

// Concurrency primitives
export { AgentMutex } from './concurrency/mutex.js';
export { AgentSemaphore } from './concurrency/semaphore.js';
export { AgentRWLock } from './concurrency/rw-lock.js';
export { AgentBarrier } from './concurrency/barrier.js';

// Workflow engine
export {
  Workflow,
  Pipeline,
  createPipeline,
  createParallelWorkflow,
} from './workflow.js';
export type {
  WorkflowStep,
  WorkflowResults,
  WorkflowOptions,
  StepId,
} from './workflow.js';

// Types
export { TypedEventEmitter, PRIORITY_VALUES } from './types.js';
export type {
  AgentId,
  ResourceId,
  TaskId,
  AgentStatus,
  TaskStatus,
  PriorityLevel,
  AgentDescriptor,
  ResourceType,
  ResourceConfig,
  ResourceDescriptor,
  ResourceHandle,
  SchedulingStrategy,
  TaskDescriptor,
  TaskSubmission,
  SchedulerConfig,
  DeadlockCycle,
  DeadlockConfig,
  DeadlockResolution,
  AgentMessage,
  MessageHandler,
  MessagePayload,
  KernelConfig,
  KernelMetrics,
  KernelEvents,
} from './types.js';
