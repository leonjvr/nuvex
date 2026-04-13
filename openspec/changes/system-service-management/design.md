# System-Level Service Management & Self-Repair — Design

## Context

NUVEX runs as a set of Docker containers orchestrated by Docker Compose:
- **brain** (FastAPI + LangGraph) — the core; depends on PostgreSQL
- **gateway-wa/tg/email** — messaging adapters; depend on brain API
- **dashboard** (FastAPI + React) — operator UI; depends on brain API
- **postgres** — database; no internal dependencies

Currently, the only health management is:
- Docker `HEALTHCHECK` directives (HTTP GET to `/health`)
- `restart: unless-stopped` policy
- Agent-level recovery recipes (section 19) for in-graph failures

There is no application-aware service dependency tracking, no cascading failure handling, and no system-level self-repair.

## Goals

1. Model NUVEX's service topology as a directed acyclic graph (DAG) with dependency edges
2. Implement application-level readiness probes that go beyond "HTTP 200" (e.g., DB pool active, model loaded)
3. Propagate failure states through the dependency graph (PostgreSQL down → brain degraded → gateways paused)
4. Provide system-level auto-recovery recipes for common failure patterns
5. Expose service health to the dashboard and API

## Key Decisions

### D1: Dependency Graph is Declarative

**Decision**: The service dependency graph is defined in `nuvex.yaml` (or `config/`), not auto-discovered.

```yaml
system:
  services:
    postgres:
      probes:
        readiness: db_pool_active
      dependencies: []
    brain:
      probes:
        readiness: langgraph_ready
        liveness: http_health
      dependencies: [postgres]
    gateway-wa:
      probes:
        readiness: wa_socket_connected
      dependencies: [brain]
    gateway-tg:
      probes:
        readiness: tg_polling_active
      dependencies: [brain]
    dashboard:
      probes:
        readiness: http_health
      dependencies: [brain]
```

**Rationale**: Declarative is simpler, auditable, and matches the existing config-driven architecture. Auto-discovery would add complexity with no real benefit (the topology is known).

### D2: Three Health States, Not Two

**Decision**: Each service has three states: `healthy`, `degraded`, `unhealthy`.

| State | Meaning |
|---|---|
| `healthy` | All probes pass; service fully operational |
| `degraded` | Service is running but a dependency is unhealthy; functionality limited |
| `unhealthy` | Service's own probes fail; not operational |

**Rationale**: Binary healthy/unhealthy doesn't capture "brain is running but DB is down" — the brain can still serve cached responses or return graceful errors.

### D3: Cascading Propagation is Upstream-Only

**Decision**: When a service becomes unhealthy, all services that depend on it transition to `degraded`. When it recovers, dependents re-check their own probes.

**Consequence**: No downstream propagation — if a gateway crashes, the brain doesn't change state (it doesn't depend on gateways).

### D4: System Recovery Recipes are Separate from Agent Recovery Recipes

**Decision**: System-level recipes live in `src/brain/system/recovery.py`, completely separate from agent-level recipes in `src/brain/recovery.py`.

**Rationale**: Different scope, different triggers, different actions. Agent recovery handles LLM failures and graph errors. System recovery handles service connectivity, stale state, and process-level issues.

### D5: Health Orchestrator Runs In-Process

**Decision**: The health orchestrator is a background asyncio task inside the brain server, not a separate sidecar.

**Rationale**: The brain already has an event loop. Adding a sidecar adds operational complexity. The orchestrator is lightweight (periodic HTTP checks + probe functions).

## Module Breakdown

| Module | Responsibility |
|---|---|
| `src/brain/system/__init__.py` | Exports `ServiceGraph`, `HealthOrchestrator`, `SystemRecovery` |
| `src/brain/system/graph.py` | `ServiceGraph`: load DAG from config; query dependencies; propagate state |
| `src/brain/system/health.py` | `HealthOrchestrator`: run probes on schedule; update service states; emit events |
| `src/brain/system/probes.py` | Probe registry: `db_pool_active`, `langgraph_ready`, `http_health`, `wa_socket_connected`, etc. |
| `src/brain/system/recovery.py` | System-level recovery recipes: `reconnect_db_pool`, `restart_gateway`, `clear_stale_locks` |
| `src/brain/system/diagnostics.py` | `DiagnosticEngine`: pattern-match error signatures → suggest recipe |
| `src/brain/routers/system.py` | `/api/v1/system/` endpoints: health, graph, diagnostics |

## Testing Strategy

- **Unit tests**: ServiceGraph — add/remove services, dependency resolution, cascade propagation
- **Unit tests**: Probes — mock DB pool, mock HTTP endpoint; verify healthy/unhealthy detection
- **Unit tests**: Recovery recipes — mock the action; verify recipe triggers and succeeds
- **Unit tests**: DiagnosticEngine — feed error patterns; verify correct recipe suggested
- **Integration test**: Full orchestrator loop — service goes unhealthy → cascade → recovery → healthy
- **No Docker required** for unit tests (all dependencies mocked)
