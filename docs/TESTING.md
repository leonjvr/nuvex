# SIDJUA Test Documentation

> Internal test suite summary for beta testers and contributors.

## Overview

- **Total Tests:** 2,172 passing | 18 skipped (env-gated) | 2,190 total
- **Test Files:** 193 passing | 5 skipped | 198 total
- **Test Framework:** Vitest
- **All Tests Passing:** Yes (0 failures)
- **Last Verified:** 2026-03-02

## Test Categories

### Unit Tests
The majority of the suite. Isolated component tests using mocked dependencies (MockProvider, in-memory SQLite, temporary directories). No external services required.

### Integration Tests
Cross-module tests verifying component interaction with real wired dependencies (real SQLite, real state machines, real event buses) but mocked LLM providers. Found in `*/integration/` subdirectories throughout the test tree.

### Environment-Gated Tests
**18 tests across 5 files.** Require live API keys and external service access. Skipped automatically in CI. Runnable locally with `SIDJUA_INTEGRATION_TESTS=1` and the appropriate API keys.

| File | Tests | Requires |
|------|-------|----------|
| tests/integration/end-to-end.integration.test.ts | 4 | `ANTHROPIC_API_KEY` |
| tests/integration/governance.integration.test.ts | 3 | `ANTHROPIC_API_KEY` |
| tests/integration/reasoning-loop.integration.test.ts | 4 | `ANTHROPIC_API_KEY` |
| tests/integration/provider-catalog.integration.test.ts | 3 | `ANTHROPIC_API_KEY` |
| tests/providers/integration/real-provider.integration.test.ts | 4 | `ANTHROPIC_API_KEY` |

## Coverage by Module

| Module | Test Files | Tests | Description |
|--------|-----------|-------|-------------|
| pipeline/ | 20 | 342 | Pre-Action Governance Pipeline (forbidden, approval, budget, classification, policy stages), task pipeline, priority queue, backpressure, ack tracking |
| agents/ | 17 | 271 | Agent runtime: reasoning loop, prompt builder, memory, checkpointing, action executor, heartbeat, process management |
| tasks/ | 17 | 212 | Task system: store, state machine, decomposition, router, event bus, result/output stores, peer consultation |
| apply/ | 11 | 211 | `sidjua apply` provisioning steps 1–10: validate, filesystem, database, secrets, RBAC, routing, skills, audit, cost centers, finalize |
| agent-lifecycle/ | 25 | 197 | Agent lifecycle management: registry, templates, skill loading, budget cascade, supervisor, crash recovery, WAL checkpointing, circuit breaker, IPC channels |
| cli/ | 20 | 192 | CLI commands (apply, run, start, health, tasks, agents, costs, logs, backup, decide, queue, output) and output formatters |
| knowledge-pipeline/ | 20 | 182 | Knowledge ingestion, chunkers (fixed/paragraph/semantic), parsers (markdown, code, CSV, HTML), embedding pipeline, hybrid retrieval, MMR diversification, policy deployment |
| orchestrator/ | 11 | 173 | Multi-agent orchestrator: delegation engine, task tree, synthesis, escalation, peer routing, execution bridge, cancellation cascade |
| provider/ | 6 | 116 | Provider registry (Phase 6): cost tracking, token counting, retry handling, audit logging, mock provider |
| core/ | 4 | 87 | Core utilities: structured error codes, logger with hot-reload, input sanitizer, backup engine |
| api/ | 8 | 70 | REST API: server, authentication + rate-limit middleware, task/agent/system/execution/output routes, SSE event streaming |
| providers/ | 10 | 54 | Provider adapters (Phase 13a): Anthropic, OpenAI, Cloudflare AI; key manager, provider catalog, auto-detection |
| tool-integration/ | 17 | 34 | Tool integration layer: registry, shell/filesystem/REST/composite adapters, governance, rate limiter, description generator |
| integration/ | 6 | 24 | Cross-module end-to-end tests: 6 mock-based (always run) + 18 env-gated (see above) |
| governance/ | 2 | 21 | Governance policies and configuration rollback/snapshot |
| setup/ | 1 | 4 | Interactive provider setup assistant |

## How to Run Tests

### All Tests
```bash
npm test
```

### Specific Module
```bash
npx vitest run tests/pipeline/
npx vitest run tests/agents/
npx vitest run tests/orchestrator/
```

### Environment-Gated Integration Tests (requires API keys)
```bash
SIDJUA_INTEGRATION_TESTS=1 ANTHROPIC_API_KEY=sk-... npm test
```

### Watch Mode (Development)
```bash
npm run test:watch
```

### With Coverage
```bash
npm run test:coverage
```

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main`/`develop` and on pull requests to `main`:

1. **test** job (Node.js 22, ubuntu-latest, 15 min timeout):
   - TypeScript type check (`npx tsc --noEmit`)
   - Full test suite (`npm test`) — env-gated tests are automatically skipped
   - Production build (`npm run build`)

2. **docker** job (depends on `test`):
   - Builds Docker image and enforces a 400 MB size limit
   - Smoke-tests the `/api/v1/health` endpoint via `docker compose up`

Environment-gated tests are not run in CI. They are intended for pre-release verification with real API credentials.

## Test Evolution

| Phase | Commit | Tests | Delta |
|-------|--------|-------|-------|
| 1–5 Apply + Pipeline | ed821bc | — | — |
| 6 Provider Layer | 53b85dd | — | — |
| 7 Task System | 30ce01f | 768 | — |
| 8 Agent Runtime | 4c58574 | 975 | +207 |
| 8 Memory Lifecycle | 8c15116 | 1,028 | +53 |
| 5 Memory Lifecycle Amendment | da450cd | 1,053 | +25 |
| 9 Orchestrator | 45144bc | 1,216 | +163 |
| 9.5 Task Pipeline | 1f4fd99 | 1,352 | +136 |
| 10.5 Agent Lifecycle | e8d4d09 | 1,572 | +220 |
| 10.5c Process Resilience | a7722fe | 1,634 | +62 |
| 10.6 Knowledge Pipeline | 5d34d77 | 1,816 | +182 |
| 10.7 Tool Integration | 0293f89 | 1,850 | +34 |
| 10.8 Audit Remediation | b3cc9b0 | 1,927 | +77 |
| 11a REST API Server | 27d9545 | 1,946 | +19 |
| 11b Core REST Endpoints | 461df45 | 1,970 | +24 |
| 11c SSE Event Streaming | f0d1a8c | 1,985 | +15 |
| 13a Provider Adapters + Key Manager | 44e6132 | 2,013 | +28 |
| 13b AgentReasoningLoop | 390dda8 | 2,029 | +16 |
| 13c ExecutionBridge + CLI + REST | 09c6d61 | 2,049 | +20 |
| 13d Provider Catalog + Setup | 43d0059 | 2,086 | +37 |
| 10.9 Backup & Restore | be6283c | 2,122 | +36 |
| 14 Dual-Storage Communication | 814a12b | 2,172 | +50 |
| 15 Test Deployment | b35de3a | 2,172 | ±0 |

## Known Limitations

- **Environment-gated tests** require a valid `ANTHROPIC_API_KEY` and `SIDJUA_INTEGRATION_TESTS=1`. They are excluded from CI runs.
- **OrchestratorProcess subprocess model** is a V1 stub. The agent-worker subprocess path is not tested end-to-end; inline execution (`sidjua run --wait`) is used for live testing.
- **GUI tests** not implemented (no web UI in V1).
- **Load/performance tests** not yet implemented; concurrent SQLite WAL access is verified manually via stress testing (`sidjua run --wait` with 6 concurrent tasks).
- **Coverage report** (`npm run test:coverage`) requires `@vitest/coverage-v8`; not tracked per-phase.

## Test Philosophy

Every phase of SIDJUA ships with tests before merging. The governance pipeline — the core differentiator — has the highest test count (342) to ensure enforcement correctness under all conditions. Integration tests within each module are co-located in `*/integration/` subdirectories alongside unit tests, keeping test intent clear without a separate test tree.

Mock providers (`MockProvider` in `src/provider/adapters/mock.ts`) queue pre-programmed responses so agent reasoning loop tests run deterministically without API calls. Environment-gated tests are the only tests that touch real LLM endpoints.
