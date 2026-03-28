# AgentKernel

> The "operating system" for multi-agent systems.

AgentKernel provides core infrastructure for building robust multi-agent applications with built-in task scheduling, resource management, deadlock detection, and inter-agent messaging.

## Features

- **Agent Lifecycle Management** - Register, terminate, and monitor agent states
- **Task Scheduling** - Multiple strategies: FIFO, Priority, Fair-Share, Round-Robin
- **Resource Management** - Mutexes, semaphores, pools, rate limiters
- **Deadlock Detection** - Automatic detection and resolution strategies
- **Priority Arbitration** - Aging-based priority inheritance
- **Message Bus** - Pub/sub and request/response messaging between agents

## Installation

```bash
npm install agent-kernel
```

## Quick Start

```typescript
import { AgentKernel } from 'agent-kernel';

const kernel = new AgentKernel({
  scheduler: {
    strategy: 'priority',
    maxConcurrent: 10,
  },
  deadlock: {
    enabled: true,
    interval: 1000,
    resolution: 'abort-lowest',
  },
});

// Register an agent
kernel.register('researcher', { priority: 'high', group: 'team-a' });

// Register a shared resource
kernel.registerResource('database', { type: 'semaphore', permits: 5 });

// Submit a task
const task = kernel.submit('researcher', {
  name: 'fetch-data',
  handler: async () => {
    return await kernel.withResource('researcher', 'database', async () => {
      // Access shared database
      return { data: 'result' };
    });
  },
  priority: 'high',
});

// Start the kernel
kernel.start();

// Monitor metrics
setInterval(() => {
  console.log(kernel.getMetrics());
}, 5000);
```

## Core Concepts

### AgentDescriptor

```typescript
interface AgentDescriptor {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'background';
  group?: string;
  metadata?: Record<string, unknown>;
  registeredAt: number;
}
```

### Resource Types

| Type | Description |
|------|-------------|
| `mutex` | Binary lock (0 or 1 holder) |
| `semaphore` | N-ary lock (permits holders) |
| `pool` | Connection/object pool |
| `rate-limit` | Token bucket rate limiting |

### Scheduling Strategies

| Strategy | Description |
|----------|-------------|
| `fifo` | First-in, first-out |
| `priority` | Higher priority first |
| `fair-share` | Time-sliced across agents |
| `round-robin` | Equal轮询 |

## API Overview

### Agent Management

```typescript
// Register an agent
kernel.register(agentId: string, options?: { priority?, group?, metadata? }): AgentDescriptor

// Terminate an agent
kernel.terminate(agentId: string): void

// List all agents
kernel.listAgents(): AgentDescriptor[]
```

### Task Submission

```typescript
kernel.submit<T>(agentId: string, task: {
  name: string;
  handler: () => T | Promise<T>;
  resources?: string[];
  dependencies?: string[];
  priority?: PriorityLevel;
}): TaskDescriptor<T>
```

### Resource Access

```typescript
// Acquire a resource
kernel.acquire(agentId: string, resourceId: string, timeoutMs?: number): Promise<ResourceHandle>

// Release a resource
kernel.release(handle: ResourceHandle): void

// Convenience wrapper
kernel.withResource(agentId, resourceId, handler, timeoutMs): Promise<T>
```

### Messaging

```typescript
// Send a message
kernel.send(from: string, to: string, payload: unknown, topic?: string): Promise<void>

// Publish to topic
kernel.publish(from: string, topic: string, payload: unknown): Promise<void>

// Subscribe to topic
kernel.subscribe(agentId: string, topic: string, handler: (msg) => void): void

// Request/Response
kernel.request(from: string, to: string, payload: unknown, timeoutMs?: number): Promise<AgentMessage>
```

### Events

```typescript
kernel.on('agent:registered', (agent) => {});
kernel.on('agent:terminated', (agent) => {});
kernel.on('agent:status-changed', (id, old, new) => {});
kernel.on('task:submitted', (task) => {});
kernel.on('task:completed', (task) => {});
kernel.on('task:failed', (task) => {});
kernel.on('resource:acquired', (handle) => {});
kernel.on('resource:released', (handle) => {});
kernel.on('deadlock:detected', (cycle) => {});
```

## Architecture

```
agent-kernel/
├── src/
│   ├── kernel.ts         # Main AgentKernel class
│   ├── types.ts          # TypeScript type definitions
│   ├── scheduler.ts      # Task scheduling engine
│   ├── resource-manager.ts # Resource allocation
│   ├── deadlock-detector.ts # Cycle detection
│   ├── priority-arbiter.ts  # Priority management
│   └── message-bus.ts    # Inter-agent messaging
├── tests/
└── examples/
```

## Deadlock Resolution

When a deadlock is detected, the kernel can:

| Strategy | Behavior |
|----------|----------|
| `abort-lowest` | Abort the lowest-priority agent in the cycle |
| `abort-youngest` | Abort the most recently submitted task |
| `notify-only` | Emit event, let user handle it |

## License

Apache License 2.0
