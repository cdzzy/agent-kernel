# Agent OS Overview

Six libraries that together form a complete operating layer for multi-agent AI systems.

| Layer | Package | Install | OS Analogy |
|-------|---------|---------|------------|
| Kernel | `@cdzzy/agent-kernel` | `npm i @cdzzy/agent-kernel` | Scheduler + resources |
| Network | `cdzzy-agentlink` | `pip install cdzzy-agentlink` | IPC / sockets |
| Memory | `@cdzzy/engram` | `npm i @cdzzy/engram` | Virtual memory |
| Policy | `cdzzy-agentconfig` | `pip install cdzzy-agentconfig` | Group policy |
| Security | `@cdzzy/traceshield` | `npm i @cdzzy/traceshield` | Audit + SELinux |
| QA | `cdzzy-agenttest` | `pip install cdzzy-agenttest` | Test framework |

## The Stack

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

## Language split

- **TypeScript**: agent-kernel, engram, traceshield
- **Python**: agentconfig, agentlink, agenttest

The halves interoperate through open protocols (MCP, A2A, HTTP) rather than shared code.
