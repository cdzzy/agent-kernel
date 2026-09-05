---
layout: home

hero:
  name: Agent OS
  text: The operating layer for multi-agent AI systems
  tagline: Six libraries that together form a complete stack — kernel, network, memory, policy, audit, and testing. Zero-dependency cores, duck-typed integrations, at-least-once recovery.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /architecture/agent-os

features:
  - title: 🧠 Kernel
    details: Priority scheduling, resource budgets, deadlock detection, concurrency primitives, work-stealing, persistent task queue, and HTTP cluster nodes.
    link: /packages/agent-kernel
  - title: 🌐 Network
    details: Message bus with pub/sub, streaming, WebSocket transport, A2A adapter, dead-letter queue, and a distributed Hub registry.
    link: /packages/agentlink
  - title: 💾 Memory
    details: Forgetting-curve decay, multi-signal recall, GraphRAG, AES-256-GCM encryption at rest, snapshots, and an MCP stdio server.
    link: /packages/engram
  - title: 📋 Policy
    details: Business-language agent configs, constraint enforcement, LLM-as-judge, framework adapters (LangGraph/AutoGen/CrewAI), and hot-reload.
    link: /packages/agentconfig
  - title: 🛡️ Audit
    details: Hash-chain traces, policy engine, failure attribution, prompt-injection detection, red-team toolkit, and ZK compliance proofs.
    link: /packages/traceshield
  - title: 🧪 Testing
    details: Agent assertions, stability testing, behavior snapshots, multi-model benchmarks, chaos engineering, and a pytest plugin.
    link: /packages/agenttest
---
