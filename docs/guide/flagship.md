# Flagship Example

The flagship example wires three layers of the stack together in one runnable story: agent-kernel schedules a researcher → writer → reviewer pipeline, traceshield audits every task into a hash-chain-verified log (rendered as a Mermaid attribution graph), and engram provides the shared long-term memory.

## Run it

```bash
cd examples/flagship
npm install   # builds the git-installed stack automatically
npm start
```

## What you get

1. **Shared memory** — findings, draft, and review stored by each agent
2. **Audit trail** — every kernel task traced with hash-chain integrity
3. **Attribution graph** — the whole run as a Mermaid diagram
4. **A live budget violation** — the writer blows its token budget → `StoredViolation`

## Architecture

```
kernel.submit(researcher)
  → researcher stores findings in engram
kernel.submit(writer, deps=[researcher])
  → writer recalls findings from engram, drafts brief
  → writer blows token budget → kernel emits budget-exceeded
kernel.submit(reviewer, deps=[writer])
  → reviewer checks draft against pricing ban, files review

attachTraceShield traces every step into traceshield's immutable log
```

The Mermaid attribution graph shows: `agent:writer → task:write-brief`, `agent:researcher → task:research`, etc.
