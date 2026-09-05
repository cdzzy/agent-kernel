# The Agent OS — Architecture Overview

Six libraries that together form a complete operating layer for multi-agent systems. Each maps to a classic OS concept; all six share one design language and interoperate.

```
        ┌─────────────────────────────────────────────────┐
        │              your agents (any framework)          │
        └──────┬──────────┬──────────┬──────────┬─────────┘
               │          │          │          │
        ┌──────▼───┐ ┌────▼─────┐ ┌──▼───────┐ ┌▼─────────┐
        │ agentlink │ │  engram   │ │agentconfig│ │traceshield│
        │  network  │ │  memory   │ │  policy   │ │  audit   │
        └──────┬───┘ └──────────┘ └──────────┘ └──────────┘
               │
        ┌──────▼────────────┐        ┌─────────────┐
        │   agent-kernel     │◄──────│  agenttest   │
        │ scheduling/limits  │  tests │             │
        └───────────────────┘        └─────────────┘
```

| Layer | Repo | OS analogy | What it gives you |
|-------|------|-----------|-------------------|
| Kernel | [agent-kernel](https://github.com/cdzzy/agent-kernel) | Scheduler + resources | Priority scheduling, resource budgets, deadlock detection, concurrency primitives, work-stealing, persistent task queue, HTTP cluster nodes |
| Network | [agentlink](https://github.com/cdzzy/agentlink) | IPC / sockets | Message bus, streaming, WebSocket transport, A2A adapter, dead-letter queue, distributed Hub registry, long-term memory bridge |
| Memory | [engram](https://github.com/cdzzy/engram) | Virtual memory | Forgetting-curve decay, multi-signal recall, GraphRAG, encryption at rest, snapshots, MCP stdio server |
| Policy | [agentconfig](https://github.com/cdzzy/agentconfig) | Group policy | Business-language configs, constraint enforcement, LLM-as-judge, framework adapters, hot-reload |
| Security | [traceshield](https://github.com/cdzzy/traceshield) | Audit + SELinux | Hash-chain traces, policy engine, attribution, red-team toolkit, ZK compliance proofs |
| QA | [agenttest](https://github.com/cdzzy/agenttest) | Test framework | Agent assertions, stability testing, snapshots, benchmarks, chaos testing, pytest plugin |

## Language split and interop

- **TypeScript**: agent-kernel, engram, traceshield
- **Python**: agentconfig, agentlink, agenttest

The halves interoperate through open protocols rather than shared code:

1. **MCP** — engram exposes memory as MCP tools (`engram-mcp`); agentlink consumes them (`attach_memory`). Any MCP client (Claude, Cursor) can use the same memory.
2. **A2A** — agentlink and agentconfig both speak Google's Agent-to-Agent protocol, so TS-hosted agents and Python-hosted agents discover each other.
3. **HTTP** — agent-kernel's cluster nodes accept remote task execution from any language.

## Integration map (all shipped)

| Bridge | Packages | Since |
|--------|----------|-------|
| Kernel → audit | agent-kernel `attachTraceShield` → traceshield `TraceRecorder` | kernel v0.5.0 |
| Bus → memory | agentlink `attach_memory` → engram MCP server | link v0.5.0 |
| Flagship example | kernel + traceshield + engram in one runnable story | kernel `examples/flagship` |

## Design principles

1. **Zero-dependency cores.** Every package runs with at most one optional dependency.
2. **Duck-typed integrations.** Bridges accept structural interfaces, never concrete classes — combine packages without forcing dependency edges.
3. **Fail-open safety.** Memory recording, auditing, and tracing never break the work they observe.
4. **At-least-once recovery.** Persistent state survives restarts; re-execution is always safe to design for.
