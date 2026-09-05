# Integrations

All bridges between packages use **duck-typed interfaces** (structural typing) — combine packages without forcing dependency edges.

| Bridge | Direction | Since |
|--------|-----------|-------|
| Kernel → audit | agent-kernel `attachTraceShield` → traceshield `TraceRecorder` | kernel v0.5.0 |
| Bus → memory | agentlink `attach_memory` → engram MCP server | link v0.5.0 |
| Flagship example | kernel + traceshield + engram | kernel `examples/flagship` |

## How it works

1. **Zero-dependency cores.** Every package runs with at most one optional dependency.
2. **Duck-typed integrations.** Bridges accept structural interfaces, never concrete classes — combine packages without forcing dependency edges.
3. **Fail-open safety.** Memory recording, auditing, and tracing never break the work they observe.
4. **At-least-once recovery.** Persistent state survives restarts; re-execution is always safe to design for.

## Open protocols for cross-language interop

- **MCP** — engram exposes memory as MCP tools (`engram-mcp`); agentlink consumes them (`attach_memory`). Any MCP client (Claude, Cursor) can use the same memory.
- **A2A** — agentlink and agentconfig both speak Google's Agent-to-Agent protocol.
- **HTTP** — agent-kernel's cluster nodes accept remote task execution from any language.
