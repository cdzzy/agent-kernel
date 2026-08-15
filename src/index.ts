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

// Health monitoring (Issue #2 / #10)
export { HealthMonitor } from './health-check.js';
export type { HealthStatus, HealthCheckConfig, AgentHealth, HealthCheckFn } from './health-check.js';

// Resource budgets (Issue #1)
export { ResourceBudgetManager } from './resource-budget.js';
export type { ResourceBudget, BudgetUsage, BudgetResource } from './resource-budget.js';

// Swarm mode (Issue #3)
export { SwarmCoordinator } from './swarm.js';
export type { SwarmAgentInfo, SwarmConfig, DispatchOptions, DispatchResult } from './swarm.js';

// A2A registry (Issue #5)
export { A2AAgentCardRegistry } from './a2a-registry.js';
export type { A2AAgentCard, A2AAgentCapability, A2ADiscoveryManifest, A2ARegistryConfig } from './a2a-registry.js';

// MCP tool registry (Issue #6)
export { MCPToolRegistry, createMCPNode, WELL_KNOWN_TOOLS, registerWellKnownTools } from './mcp-registry.js';
export type { MCPTool, MCPToolDefinition, MCPToolHandler, MCPToolContext } from './mcp-registry.js';

// Model routing (Issue #7)
export { ModelRouter } from './model-router.js';
export type { ModelTier, ModelRoute, ModelRouterConfig } from './model-router.js';

// Observability (Issue #8)
export { Observability } from './observability.js';
export type { ObservabilityMetrics, AlertRule, Counter } from './observability.js';

// Task decomposition (Issue #9)
export { TaskDecomposer } from './decomposition.js';
export type { SubTask, DecompositionResult, DecompositionConfig } from './decomposition.js';

// Self-evolution
export { SelfEvolutionManager } from './self-evolution.js';

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
