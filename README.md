# agent-kernel ⚙️

**The operating system kernel for multi-agent systems.**

Like an OS kernel manages processes, agent-kernel manages concurrent AI agents — scheduling, resource allocation, deadlock detection, and message routing.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](tests/)

---

## The Problem

Running multiple AI agents concurrently is hard. Without coordination:

- Agents compete for shared resources (API rate limits, memory, tools)
- Long-running tasks block short, urgent ones
- Agents can deadlock waiting for each other's output
- No visibility into what's running, what's waiting, what failed

**agent-kernel solves this.** It's the runtime that gives multi-agent systems the same reliability guarantees that OS kernels give to processes.

---

## Features

- ⚡ **Priority scheduler** — agents run by priority (CRITICAL → HIGH → NORMAL → LOW → BACKGROUND)
- 🔒 **Resource manager** — cap concurrent LLM calls, tool invocations, and memory usage
- 💰 **Resource budgets** — per-agent token / wall-time / tool-call limits (v0.2.0)
- 💬 **Message bus** — pub/sub and point-to-point messaging between agents
- 🔁 **Rate limiter** — token bucket rate limiting per agent or globally
- 🔍 **Deadlock detector** — detect and resolve circular wait conditions
- 🎯 **Priority arbiter** — resolve resource conflicts between competing agents
- 🔄 **Concurrency primitives** — mutex, semaphore, and barrier for agent coordination
- ❤️ **Health monitoring** — fleet health checks with auto-recovery (v0.2.0)
- 🐝 **Swarm mode** — decentralized capability-aware routing (v0.2.0)
- 🧠 **Model router** — complexity-aware routing to fast/standard/reasoning models (v0.2.0)
- 📊 **Observability** — Prometheus-style metrics + alerting (v0.2.0)
- 🗂️ **Task decomposition** — hierarchical task breakdown with Mermaid/DOT graphs (v0.2.0)
- 🔌 **A2A registry** — Agent Card service discovery (v0.2.0)
- 🛠️ **MCP tool registry** — centralized tool management with access control (v0.2.0)

---

## Installation

```bash
npm install agent-kernel
```

---

## Quick Start

```typescript
import { Kernel } from 'agent-kernel';

// Create a kernel with resource limits
const kernel = new Kernel({
  maxConcurrentAgents: 10,
  globalRateLimit: { tokensPerSecond: 100 },
  deadlockCheckInterval: 5000,
});

// Register an agent task
const taskId = await kernel.schedule({
  agentId: 'researcher',
  priority: 'HIGH',
  resources: ['llm:gpt-4o', 'tool:web-search'],
  run: async (ctx) => {
    const result = await ctx.tools.webSearch('latest AI news');
    return { summary: result.topResults };
  },
});

// Wait for result
const result = await kernel.waitFor(taskId);
console.log(result.summary);
```

---

## Core Concepts

### Priority Levels

```typescript
type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BACKGROUND';
```

- **CRITICAL** — user-facing, blocks UI, must complete immediately
- **HIGH** — important background work, preempts NORMAL
- **NORMAL** — default for most agent tasks
- **LOW** — non-urgent, runs when system is idle
- **BACKGROUND** — maintenance tasks (memory sweep, log archival)

### Resource Manager

Prevent agents from overwhelming external APIs:

```typescript
kernel.setResourceLimit('llm:gpt-4o', {
  maxConcurrent: 5,       // max 5 simultaneous calls
  maxPerMinute: 60,       // 60 calls per minute
  maxTokensPerHour: 1_000_000, // token budget
});
```

### Message Bus

Agents communicate without direct coupling:

```typescript
import { MessageBus } from 'agent-kernel';

const bus = new MessageBus();

// Subscribe
bus.subscribe('research.complete', async (msg) => {
  console.log(`Research done: ${msg.payload.summary}`);
});

// Publish
await bus.publish('research.complete', {
  agentId: 'researcher',
  payload: { summary: '...' },
});

// Point-to-point
await bus.send('writer-agent', {
  type: 'REQUEST',
  content: 'Please summarize this research',
  replyTo: 'coordinator-agent',
});
```

### Deadlock Detection

```typescript
const kernel = new Kernel({
  deadlockDetection: {
    enabled: true,
    checkInterval: 5000,     // check every 5 seconds
    resolution: 'abort-lowest-priority', // or 'timeout' | 'manual'
    onDeadlock: (cycle) => {
      console.error(`Deadlock detected: ${cycle.map(a => a.agentId).join(' → ')}`);
    },
  },
});
```

---

## Scheduler

The scheduler implements priority-based preemptive scheduling:

```typescript
import { Scheduler } from 'agent-kernel';

const scheduler = new Scheduler({
  algorithm: 'priority-preemptive',
  timeSlice: 1000,  // ms before checking for higher-priority tasks
  agingEnabled: true,  // prevent starvation of low-priority tasks
});
```

---

## Comparison

| Feature | agent-kernel | LangGraph | AutoGen | CrewAI |
|---------|-------------|-----------|---------|--------|
| Priority scheduling | ✅ | ❌ | ❌ | ❌ |
| Resource limits | ✅ | ⚠️ | ❌ | ❌ |
| Deadlock detection | ✅ | ❌ | ❌ | ❌ |
| Framework-agnostic | ✅ | ❌ | ❌ | ❌ |
| Concurrency primitives | ✅ | ❌ | ❌ | ❌ |

---

## Roadmap

- [x] Agent health checks and auto-restart policies ✅ (src/health-check.ts, v0.2.0)
- [x] Resource budget system ✅ (src/resource-budget.ts, v0.2.0)
- [x] Swarm mode (decentralized routing) ✅ (src/swarm.ts, v0.2.0)
- [x] A2A native support (Agent Card discovery) ✅ (src/a2a-registry.ts, v0.2.0)
- [x] MCP tool integration layer ✅ (src/mcp-registry.ts, v0.2.0)
- [x] Reasoning model routing ✅ (src/model-router.ts, v0.2.0)
- [x] Observability dashboard + metrics ✅ (src/observability.ts, v0.2.0)
- [x] Task decomposition + dependency graph ✅ (src/decomposition.ts, v0.2.0)
- [x] Docker Compose deployment ✅ (docker-compose.yml, v0.2.0)
- [ ] Distributed mode (multi-node kernel cluster)
- [ ] OpenTelemetry tracing integration
- [ ] Kernel inspection CLI (`agent-kernel status`, `agent-kernel top`)
- [ ] Work-stealing scheduler for load balancing
- [ ] Persistent task queue (survive kernel restarts)

---

## Examples

```
examples/
  01_quickstart.ts         # Single agent with kernel
  02_priority_demo.ts      # Mixed-priority agents
  03_resource_limits.ts    # Rate limiting in action
  04_message_bus.ts        # Agent communication patterns
  05_deadlock_scenario.ts  # Deadlock detection and resolution
```

---

## License

MIT © cdzzy
