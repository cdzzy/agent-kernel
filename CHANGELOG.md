# Changelog

All notable changes to AgentKernel are documented in this file.

## [0.10.0] - 2026-10-10

### Changed

- **Upgraded vitest 3.2.7 → 5.0.3, resolving the deferred `@vitest/mocker`
  advisory**
  ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
  moderate): dev-server redirect-mock registration lacked `server.fs` allowlist
  validation. Fixed upstream in vitest 5.0.0; vitest 3.x is unmaintained and
  will not receive a backport. This closes out the vitest half of the deferral
  documented in 0.9.0.
- **Minimum supported Node is now 22.12** (`engines`), the floor required by
  vitest 5 (`^22.12.0 || ^24.0.0 || >=26.0.0`). The CI matrix now runs on
  Node 22 / 24 / 26 (Node 20 dropped — vitest 5 no longer installs on it).
- **Added `vite@^8.3.4` as an explicit devDependency**: vitest 5 declares
  Vite as a required peer (`^6.4.0 || ^7.0.0 || ^8.0.0`). It coexists with
  `vitepress` 1.6.x, which keeps its own nested vite 5 for the docs site.
- **Removed the `overrides` block** (tinypool `2.1.2`, source-map-js `1.2.2`):
  vitest 5 ships a fully patched dependency chain, so the 0.9.0-era pins are
  obsolete.

### Security

- The remaining audit findings are confined to the docs-only vitepress chain
  (vitepress 1.6.4 → vite 5.4 → esbuild `<=0.24.2`,
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)):
  2 moderate + 1 high, exposed only by a local `docs:dev` server, never in
  CI (docs builds statically). No fix exists on vitepress 1.x; the fix path
  is the vitepress 2.0 line, still in alpha (2.0.0-alpha.20) and not suitable
  for a stable release train. Accepted and documented, as in 0.9.0.

### Verified

- All 139 tests pass on vitest 5.0.3 (the suite uses no `vi.mock`/`vi.hoisted`
  nesting, empty-`toThrow` assertions, or benchmark APIs — the v5 breaking
  changes do not apply). Lint, typecheck, and build are green.

## [0.9.0] - 2026-10-09

### Changed

- **Node 18 is EOL — minimum supported Node is now 20** (`engines`), matching
  the CI matrix which now runs on Node 20 / 22 / 24. Node 18 reached
  end-of-life on 2025-04-30 and the test toolchain (tinypool 2.x) no longer
  supports it.
- **Dev toolchain security hardening**: `overrides` force `tinypool@2.1.2`
  and `source-map-js@1.2.2`, closing the critical tinypool
  prototype-pollution-to-RCE advisories
  ([GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3),
  [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr))
  and the high source-map-js event-loop denial of service
  ([GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q))
  in the vitest dependency chain. All 139 tests pass against tinypool 2.1.2.
  Remaining audit findings are accepted dev-only with no non-breaking fix: the
  vitest mock helper ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
  moderate, requires vitest 5.0 / Node ≥ 22.12) and the esbuild dev-server
  advisory via vitepress (moderate, while vitepress 1.6.x pins vite 5).

### Fixed

- **Agent status lifecycle** (`kernel.ts`, `scheduler.ts`, `resource-manager.ts`):
  agents previously stayed `running` forever once they received work — the
  `release()` path carried an empty block with a comment promising an idle
  transition that was never implemented, so `getMetrics().agents` always showed
  inflated `running` counts. Now the kernel drives status from the scheduler:
  a starting task marks the agent `running`, and when its last task settles
  (completed/failed/cancelled) *and* it holds no resource handles, the agent
  falls back to `idle`. The check is deferred one microtask because the
  scheduler emits settle events before it removes the task from its running
  set. New `Scheduler.getRunningCountForAgent()` and
  `ResourceManager.hasHandles()` back the transition. 3 new tests cover
  settle-to-idle, staying running while a sibling task is in flight, and
  release-to-idle.
- **Dependency security**: transitive `brace-expansion` (ESLint dev tree)
  bumped past 1.1.20, clearing the high-severity GHSA-q2hr-2g5m-vwhr /
  GHSA-qhr7-859c-m2p7 / GHSA-6j4f-fj2g-mc7p advisories.

## [0.8.0] - 2026-10-02

### Added

- **Handoff orchestration** (runtime agent-to-agent handoff, the pattern popularized by OpenAI Swarm and Anthropic's multi-agent systems): `HandoffCoordinator` lets an agent's handler yield control mid-execution by raising a `HandoffSignal`. Two modes — `transfer` (control moves to the target like a `goto`; the sender exits the chain) and `delegate` (function-call semantics: the delegate's return value is fed back into the sender as its new payload, and nested delegates unwind as a stack). Targets resolve by exact agent id first, then by capability name routed to the least-busy advertising agent (candidates unknown to the kernel are skipped). Every hop is journaled into an auditable `chain` and executed through `kernel.submit()`, so priorities, resources, metrics, and the TraceShield bridge all observe handoff traffic. Guardrails: transfer cycles fail fast (delegate revisits are legal), `maxChainDepth` caps runaway chains (default 10, checked before journaling), and `timeoutMs` budgets the whole chain. Failures throw `HandoffExecutionError` carrying the full result (status, chain, error); `handoff`/`completed`/`failed` events and `getStats()` expose chain telemetry.
- `TypedEventEmitter` is now generic over its event map (`TypedEventEmitter<Events>`, defaulting to `KernelEvents` — fully backward compatible), so subsystems with their own event surfaces such as `HandoffCoordinator` get properly typed `emit`/`on`/`off`/`once` instead of overloading the kernel's event names.

## [0.7.2] - 2026-09-25

### Changed

- `js-yaml` bumped 5.3.0 → 5.4.2 and vitest → 3.2.7 (patched transitive chain); `npm audit` now reports zero production vulnerabilities (remaining findings are dev-only vitest mock helper, accepted due to the Node 18/20/22 CI matrix).
- 16 ESLint unused-symbol warnings eliminated across the scheduler, resource manager, priority arbiter, kernel, MCP registry and A2A registry — unused type imports removed, dead loop bindings dropped, the unused `agentId` parameter renamed `_agentId`, and `ignoreRestSiblings` enabled for the intentional omit-destructuring in `toolToDefinition`.

## [0.7.1] - 2026-09-20

### Changed

- README repositioned: Agent Kernel is described as a runtime kernel and scheduling layer for AI agents, with a new section on how it relates to LangGraph / Microsoft Agent Framework / AgentScope (English + Chinese, docs mirrored).

### Fixed

- CI no longer swallows type-check and build failures (the `npx tsc ... || true` shortcuts are gone); lint and test steps added, `npm install` replaced with `npm ci`.
- Release workflow added: scoped `npm publish --access public` on `v*` tags, guarded on `NPM_TOKEN`.

## [0.7.0] - 2026-09-04

### Added

- **Distributed mode — HTTP cluster nodes**: `KernelHttpEndpoint` exposes a kernel over HTTP (POST /tasks, GET /tasks/:id, GET /health, optional bearer-token auth); `RemoteKernelClient` submits tasks to remote kernels, polls for completion, and exposes `execute()` (submit+wait). Handlers are referenced by name via `ClusterHandlerRegistry` (closures stay local — tasks cross the wire as references + input).

## [0.6.0] - 2026-09-04

### Added

- **Persistent task queue** (`#`Roadmap): `PersistentTaskQueue` write-ahead journals every submission to a JSONL file and re-submits unfinished tasks into a fresh kernel (`recover`) — at-least-once semantics with dependency remapping across restarts. Handlers are referenced by name via a registry (`registerHandler`) since closures cannot be serialized. `compact()` trims the journal to pending work; `recoverFailed` optionally retries tasks that failed before the crash.

## [0.5.0] - 2026-09-04

### Added

- **TraceShield audit bridge**: `attachTraceShield(kernel, recorder, options)` streams kernel lifecycle events into a traceshield-compatible `TraceRecorder` — every task becomes a trace/span (completed/failed with error details), and deadlocks, budget overruns, and health alarms become `StoredViolation`s (opt-in per category). Recorder is duck-typed: no hard dependency on traceshield.

## [0.4.0] - 2026-08-27

### Added

- **Work-stealing scheduler**: `WorkStealingPool` gives each worker a local queue; idle workers steal from the busiest victim (BLAS-style, above a configurable threshold) and rebalance submits stolen work through the kernel so priorities and resource limits still apply. Optional auto-rebalance interval.

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
