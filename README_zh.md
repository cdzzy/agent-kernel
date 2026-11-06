# agent-kernel ⚙️

**面向 AI 智能体的运行时内核与调度层。**

就像操作系统内核管理进程一样，agent-kernel 负责管理并发运行的 AI 智能体 —— 抢占式调度、资源限额、死锁检测和消息路由。它是编排框架之下的基础设施层，而不是又一个竞争性的编排框架。

[![npm](https://img.shields.io/npm/v/@cdzzy%2Fagent-kernel?color=red)](https://www.npmjs.com/package/@cdzzy/agent-kernel)
[![CI](https://github.com/cdzzy/agent-kernel/actions/workflows/ci.yml/badge.svg)](https://github.com/cdzzy/agent-kernel/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](tests/)

[English](./README.md) | **中文**

---

## 问题背景

并发运行多个 AI 智能体是一项挑战。缺乏协调时：

- 智能体争抢共享资源（API 速率限制、内存、工具）
- 长时间运行的任务会阻塞短暂而紧急的任务
- 智能体可能因等待彼此输出而产生死锁
- 无法看清哪些在运行、哪些在等待、哪些已失败

**agent-kernel 解决了这些问题。** 它是多智能体系统的运行时，为其提供与操作系统内核对进程同等级别的可靠性保障。

---

## 功能特性

- ⚡ **优先级调度器** — 按优先级运行智能体（CRITICAL → HIGH → NORMAL → LOW → BACKGROUND）
- 🔒 **资源管理器** — 限制并发 LLM 调用数、工具调用数和内存用量
- 💬 **消息总线** — 智能体间支持发布/订阅和点对点消息通信
- 🔁 **速率限制器** — 基于令牌桶算法，支持按智能体或全局限流
- 🔍 **死锁检测器** — 自动检测并解决循环等待问题
- 🎯 **优先级仲裁器** — 解决竞争智能体之间的资源冲突
- 🔄 **并发原语** — 提供互斥锁、信号量和屏障，用于智能体协调

---

## 安装

```bash
npm install agent-kernel
```

---

## 快速上手

```typescript
import { Kernel } from 'agent-kernel';

// 创建内核并设置资源限制
const kernel = new Kernel({
  maxConcurrentAgents: 10,
  globalRateLimit: { tokensPerSecond: 100 },
  deadlockCheckInterval: 5000,
});

// 注册一个智能体任务
const taskId = await kernel.schedule({
  agentId: 'researcher',
  priority: 'HIGH',
  resources: ['llm:gpt-4o', 'tool:web-search'],
  run: async (ctx) => {
    const result = await ctx.tools.webSearch('最新 AI 动态');
    return { summary: result.topResults };
  },
});

// 等待结果
const result = await kernel.waitFor(taskId);
console.log(result.summary);
```

---

## 核心概念

### 优先级等级

```typescript
type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BACKGROUND';
```

| 等级 | 说明 |
|------|------|
| **CRITICAL** | 直接影响用户界面，必须立即完成 |
| **HIGH** | 重要的后台任务，可抢占 NORMAL 级别 |
| **NORMAL** | 大多数智能体任务的默认级别 |
| **LOW** | 非紧急任务，系统空闲时运行 |
| **BACKGROUND** | 维护性任务（内存清理、日志归档等） |

### 资源管理器

防止智能体压垮外部 API：

```typescript
kernel.setResourceLimit('llm:gpt-4o', {
  maxConcurrent: 5,            // 最多 5 个并发调用
  maxPerMinute: 60,            // 每分钟最多 60 次调用
  maxTokensPerHour: 1_000_000, // 每小时 Token 预算
});
```

### 消息总线

智能体之间无需直接耦合即可通信：

```typescript
import { MessageBus } from 'agent-kernel';

const bus = new MessageBus();

// 订阅消息
bus.subscribe('research.complete', async (msg) => {
  console.log(`研究完成: ${msg.payload.summary}`);
});

// 发布消息
await bus.publish('research.complete', {
  agentId: 'researcher',
  payload: { summary: '...' },
});

// 点对点发送
await bus.send('writer-agent', {
  type: 'REQUEST',
  content: '请总结这份研究报告',
  replyTo: 'coordinator-agent',
});
```

### 死锁检测

```typescript
const kernel = new Kernel({
  deadlockDetection: {
    enabled: true,
    checkInterval: 5000,              // 每 5 秒检查一次
    resolution: 'abort-lowest-priority', // 或 'timeout' | 'manual'
    onDeadlock: (cycle) => {
      console.error(`检测到死锁: ${cycle.map(a => a.agentId).join(' → ')}`);
    },
  },
});
```

---

## 调度器

调度器实现了基于优先级的抢占式调度：

```typescript
import { Scheduler } from 'agent-kernel';

const scheduler = new Scheduler({
  algorithm: 'priority-preemptive', // 优先级抢占式算法
  timeSlice: 1000,   // 每隔多少毫秒检查是否有更高优先级的任务
  agingEnabled: true, // 防止低优先级任务长期饿死
});
```

---

## 与 LangGraph / Microsoft Agent Framework / AgentScope 的关系

agent-kernel **不是**又一个编排框架 —— 它是这些编排框架之下的运行时层。

| 层次 | 职责 |
|------|------|
| **编排框架** — LangGraph、Microsoft Agent Framework、AgentScope、CrewAI 等 | 图/工作流设计、状态机、提示词、智能体角色与任务交接 |
| **agent-kernel**（本项目） | 抢占式调度、资源限额与预算、死锁检测、持久化任务队列 |

具体来说：

- **LangGraph** 把工作流编译成图并逐节点执行。agent-kernel 可以承载这段执行 —— 决定每个节点的工作*何时*运行、限制其 LLM/工具并发数，并检测图分支之间的死锁。
- **Microsoft Agent Framework**（AutoGen 的后继者）负责协调多智能体工作流与对话。agent-kernel 为这些对话提供底层的调度与资源治理，避免一个高话痨智能体饿死 CRITICAL 级任务。
- **AgentScope** 构建基于消息传递的多智能体应用。agent-kernel 在其消息层之下补充优先级调度、速率限制与死锁检测。

编排框架回答"智能体做什么、工作流如何流转"；agent-kernel 回答"同时跑多少、谁抢占谁、资源耗尽时怎么办"。由于它是框架无关的，可以渐进式引入：把任意框架的执行步骤包进 `kernel.schedule(...)`，即可获得调度、限额与可观测性，而无需重写你的图或工作流。

---

## 与 Temporal（持久化执行）的关系

Temporal 是**持久化执行（durable execution）**的事实基座：它持久化工作流
状态、跨进程崩溃存活、恢复定时器/信号/活动，并提供确定性重放。
agent-kernel 刻意**不**在这里竞争：它不做工作流检查点、不重放历史、也不承诺
跨重启的 exactly-once 恢复。重造这套能力是多年工程，而且没有必要 ——
Temporal 已经做好了，并在 2026 年原生集成了 Google ADK、OpenAI Agents SDK、
AWS Strands、LangGraph、LangSmith、Vercel AI SDK 与 Gemini SDK。

分工边界：

| 关注点 | Temporal | agent-kernel |
|---|---|---|
| 持久化工作流状态、崩溃恢复、确定性重放 | ✅ 负责 | ❌ 不在范围内 |
| 定时器、信号、长时间人工等待 | ✅ | ❌ |
| 智能体之间的优先级 / 抢占式调度 | ⚠️ 仅队列路由 | ✅ |
| Token、成本、并发预算与单智能体资源限额 | ❌ | ✅ |
| 死锁检测与解除 | ❌ | ✅ |
| 编排框架之下的框架无关运行时 | ✅（工作流 SDK） | ✅（智能体执行） |

`PersistentTaskQueue` 是至少一次（at-least-once）的任务日志 —— 它保证排队任务
不丢失，但不是工作流检查点，也不重放工作流的状态历史。

**二者可组合。** 用 Temporal 负责持久性，把每个 activity 里的智能体工作交给
内核调度，从而获得优先级、预算与死锁检查：

```typescript
import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { runAgentStep } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
});

export async function supportWorkflow(ticket: Ticket): Promise<string> {
  // 持久性归 Temporal：该 activity 能跨 worker 崩溃并重放。
  // 在其内部，agent-kernel 决定谁运行、用多少资源：
  //   return kernel.schedule(agent, task, {
  //     priority: 'HIGH',
  //     budget: { tokens: 50_000 },
  //   });
  return runAgentStep(ticket);
}
```

判断准则：需求是"崩溃后从断点精确恢复"，选 Temporal；需求是"下一个谁跑、
能花多少、集群是否死锁"，选 agent-kernel。两者同时部署才是预期形态。

---

## 对比同类方案

| 功能 | agent-kernel | LangGraph | AutoGen | CrewAI |
|------|-------------|-----------|---------|--------|
| 优先级调度 | ✅ | ❌ | ❌ | ❌ |
| 资源限制 | ✅ | ⚠️ | ❌ | ❌ |
| 死锁检测 | ✅ | ❌ | ❌ | ❌ |
| 框架无关 | ✅ | ❌ | ❌ | ❌ |
| 并发原语 | ✅ | ❌ | ❌ | ❌ |

---

## 路线图

- [x] 智能体健康检查与自动重启策略 ✅（src/health-check.ts，v0.2.0）
- [x] 资源预算系统 ✅（src/resource-budget.ts，v0.2.0）
- [x] 蜂群模式（去中心化能力路由）✅（src/swarm.ts，v0.2.0）
- [x] A2A 原生支持（Agent Card 服务发现）✅（src/a2a-registry.ts，v0.2.0）
- [x] MCP 工具集成层 ✅（src/mcp-registry.ts，v0.2.0）
- [x] 推理模型路由 ✅（src/model-router.ts，v0.2.0）
- [x] 可观测性仪表盘 + 指标 ✅（src/observability.ts，v0.2.0）
- [x] 任务分解 + 依赖图 ✅（src/decomposition.ts，v0.2.0）
- [x] Docker Compose 部署 ✅（docker-compose.yml，v0.2.0）
- [x] **TraceShield 审计桥接**（`attachTraceShield` — 每个任务、死锁、预算与健康事件都会落入防篡改审计日志）✅（v0.5.0）
- [x] **内核检查 CLI**（`agent-kernel status`、`agent-kernel agents`、`agent-kernel top`）✅（v0.3.0）
- [x] **工作窃取调度器**（`WorkStealingPool` — 空闲工作节点从最繁忙的队列窃取任务，经内核重新均衡）✅（v0.4.0）
- [x] **持久化任务队列**（`PersistentTaskQueue` — 预写日志、至少一次恢复、依赖重映射）✅（v0.6.0）
- [x] **分布式模式**（`KernelHttpEndpoint` + `RemoteKernelClient` — 通过 HTTP 暴露内核，在远程机器上以命名处理器执行任务）✅（v0.7.0）
- [ ] OpenTelemetry 链路追踪集成

---

## 示例

```
examples/
  01_quickstart.ts         # 单智能体与内核基础用法
  02_priority_demo.ts      # 混合优先级智能体演示
  03_resource_limits.ts    # 速率限制实战
  04_message_bus.ts        # 智能体通信模式
  05_deadlock_scenario.ts  # 死锁检测与解决
```

---

## 许可证

MIT © cdzzy
