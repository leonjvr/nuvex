# System-Level Service Management & Self-Repair — Proposal

## Why

NUVEX already has **agent-level recovery recipes** (section 19) that handle failures within a single agent's execution — retry, reset context, escalate. But a real operating system also manages **system services**: it knows the dependency graph between processes, can restart crashed services, and handles cascading failures.

Currently, NUVEX's services (brain, gateways, dashboard, PostgreSQL) are managed by Docker Compose with basic `restart: unless-stopped`. This means:

1. **No dependency awareness** — if PostgreSQL restarts, the brain doesn't know to reconnect or re-validate state
2. **No cascading failure handling** — a gateway crash doesn't notify the brain to pause message routing
3. **No readiness distinction** — Docker's health check is binary (healthy/unhealthy); there's no "degraded" or "starting up" state that the brain can react to
4. **No self-diagnosis** — when something goes wrong, operators must SSH in and debug manually; the system can't diagnose and fix common issues itself

A classical OS has `systemd`/`launchd` — a service manager that understands dependencies, ordering, and restart policies. An AI OS should have an equivalent that is aware of AI-specific service topology.

## What

Add a **service management layer** that:

- Models NUVEX services as a dependency graph (brain depends on PostgreSQL; gateways depend on brain)
- Monitors service health beyond Docker health checks (application-level readiness probes)
- Automatically recovers from common system failures (reconnect DB, restart gateway, clear stale locks)
- Provides cascading failure notifications (PostgreSQL down → brain enters degraded mode → gateways pause)
- Exposes system health to the dashboard with dependency visualisation

## Capabilities Added

| Capability | Description |
|---|---|
| Service dependency graph | DAG of NUVEX services with startup ordering and dependency edges |
| Application readiness probes | Custom health checks beyond HTTP 200 (DB connection pool, queue depth, model loaded) |
| Cascading state propagation | Service failure propagates "degraded" upstream through the dependency graph |
| Auto-recovery recipes | System-level recipes: reconnect DB pool, restart gateway process, clear stale checkpoints |
| Diagnostic engine | Pattern-match common failure signatures → suggest or auto-apply fix |
| Dashboard visualisation | Live service dependency graph with health status per node |

## Impact

- **New module**: `src/brain/system/__init__.py` — service management package
- **New module**: `src/brain/system/graph.py` — service dependency DAG
- **New module**: `src/brain/system/health.py` — readiness probe registry
- **New module**: `src/brain/system/recovery.py` — system-level recovery recipes
- **New module**: `src/brain/system/diagnostics.py` — failure pattern matching
- **Modified**: `src/brain/server.py` — register service probes on startup; expose system health API
- **Modified**: `src/brain/routers/` — new `/api/v1/system/` endpoints
- **Modified**: Docker health checks — probes called by the health orchestrator, not just Docker
- **No breaking changes** — all new functionality; existing recovery recipes (agent-level) unchanged

## Priority

**LOW** — This is an operational maturity feature. It makes NUVEX more self-managing but is not required for core agent functionality. Should be implemented after all higher-priority gaps are closed and the system is running in production with real operator feedback.
