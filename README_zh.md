# agent-kernel ⚙️

**多智能体系统的操作系统内核。**

就像操作系统内核管理进程一样，agent-kernel 负责管理并发运行的 AI 智能体 —— 调度、资源分配、死锁检测和消息路由。

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

- [ ] 分布式模式（多节点内核集群）
- [ ] 集成 OpenTelemetry 链路追踪
- [ ] 内核检查 CLI（`agent-kernel status`、`agent-kernel top`）
- [ ] 负载均衡的工作窃取调度器
- [ ] 持久化任务队列（支持内核重启后恢复）
- [ ] 智能体健康检查与自动重启策略

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
