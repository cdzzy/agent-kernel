# Quick Start

## TypeScript (kernel + memory + audit)

```bash
npm install @cdzzy/agent-kernel @cdzzy/engram @cdzzy/traceshield
```

```typescript
import { AgentKernel, ResourceBudgetManager, attachTraceShield } from 'agent-kernel';
import { TraceRecorder, MemoryStorage } from 'traceshield';
import { MemoryManager } from 'engram';

const kernel = new AgentKernel();
kernel.register('my-agent');
kernel.start();

const budgets = new ResourceBudgetManager(kernel, { maxTokens: 10_000 });

const recorder = new TraceRecorder({ storage: new MemoryStorage() });
attachTraceShield(kernel, recorder, {
  sessionId: 'prod-1',
  violations: { deadlocks: true, budgets: true },
});

// Every task is now scheduled, budget-checked, and audited
const task = kernel.submit('my-agent', {
  name: 'do-work',
  handler: async () => 'result',
});
```

## Python (messaging + policy + testing)

```bash
pip install cdzzy-agentconfig cdzzy-agentlink cdzzy-agenttest
```

```python
from agentlink import AgentNode, AgentBus

bus = AgentBus()
node = AgentNode("researcher", handler=my_fn)
bus.register(node)

reply = node.send("other-agent", "What is 2+2?")
```

## Cross-language interop

```python
# Python agentlink node joins the TS kernel's fleet via engram MCP
from agentlink.integrations.engram import attach_memory

backend = attach_memory(bus, command="engram-mcp")  # Node memory server
```
