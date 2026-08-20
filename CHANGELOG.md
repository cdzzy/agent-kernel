# Changelog

All notable changes to AgentKernel are documented in this file.

## [0.3.0] - 2026-08-19

### Added

- **Kernel inspection CLI**: `agent-kernel status` / `agents` / `top` report fleet metrics, registered agents, resource state, and task summary. `--register` spawns demo agents. Typed `CliError`; bin entry lives in `cli-main.ts`.

## [0.2.0] - 2026-08-15

### Added

- **Resource budget system** (`#1`): `ResourceBudgetManager` enforcing per-agent token / wall-time / tool-call / memory limits, emitting `budget-exceeded` events.
- **Health monitoring + auto-recovery** (`#2`, `#10`): `HealthMonitor` with per-agent checks, consecutive-failure tracking, recovery policy (restart/failover/alert-only), and `health.degraded`/`health.critical` events.
- **Swarm mode** (`#3`): `SwarmCoordinator` for decentralized, capability-aware routing with replication-based fault tolerance.
- **Docker Compose deployment** (`#4`): `Dockerfile` + `docker-compose.yml` with optional Prometheus/Grafana monitoring profile.
- **A2A native support** (`#5`): `A2AAgentCardRegistry` for Agent Card discovery manifests (existing module, now exported).
- **MCP tool integration** (`#6`): `MCPToolRegistry` for centralized tool management (existing module, now exported).
- **Reasoning model routing** (`#7`): `ModelRouter` with complexity detection and fast/standard/reasoning tiers.
- **Observability** (`#8`): `Observability` metrics registry with Prometheus text exposition and alert rules.
- **Hierarchical task decomposition** (`#9`): `TaskDecomposer` with Mermaid/DOT/JSON dependency-graph output.

### Changed

- Reconciled legacy modules onto the current `AgentKernel` API: rewrote `workflow.ts` (now uses `kernel.submit()`), rewrote `health-check.ts`, and removed the broken `kernel-cli.ts` demo.
- Fixed pre-existing typecheck/build errors (scheduler config, MCP registry types) so `tsc` and the CI build pass.
- Fixed git repository: renamed 25 files that had literal backslashes in their names (invalid on Windows) to proper forward-slash paths.

## [0.1.0]

- Initial release: priority scheduler, resource manager, message bus, rate limiter, deadlock detector, priority arbiter, concurrency primitives.
