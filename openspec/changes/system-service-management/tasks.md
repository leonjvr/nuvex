## 1. Service Dependency Graph

> Spec: `specs/service-dependency-graph/spec.md`
>
> Declarative DAG of NUVEX services with cascading health propagation.
>
> **Priority: LOW** — Foundational module for system-level awareness.

- [ ] 1.1 Create `src/brain/system/__init__.py` — exports `ServiceGraph`, `HealthOrchestrator`, `SystemRecovery`, `DiagnosticEngine`
- [ ] 1.2 Create `src/brain/system/models.py` — Pydantic models: `ServiceState` enum (healthy, degraded, unhealthy), `ServiceNode(name, state, dependencies, probes)`, `StateTransition(service, old_state, new_state, triggered_by)`
- [ ] 1.3 Create `src/brain/system/graph.py` — `ServiceGraph` class: `load(config)`, `get_dependencies(name)`, `get_transitive_dependencies(name)`, `get_dependents(name)`, `startup_order()`, `to_dict()`
- [ ] 1.4 Implement circular dependency detection — `load()` raises `CircularDependencyError` if DAG has a cycle
- [ ] 1.5 Implement state evaluation — given probe results, compute each service's state (healthy/degraded/unhealthy)
- [ ] 1.6 Implement upstream cascade — when a service becomes unhealthy, re-evaluate all dependents transitively
- [ ] 1.7 Emit `system.service_state_changed` event on every state transition

## 2. Readiness Probes

> Spec: `specs/health-orchestrator/spec.md` (probe section)
>
> Application-level health checks beyond Docker HEALTHCHECK.
>
> **Priority: LOW** — Depends on §1.

- [ ] 2.1 Create `src/brain/system/probes.py` — `ProbeRegistry` class: `register(probe_id, probe_fn)`, `get(probe_id)`, `list_probes()`
- [ ] 2.2 Implement `http_health` probe — async `GET /health` with configurable timeout (default 5s)
- [ ] 2.3 Implement `db_pool_active` probe — execute `SELECT 1` on SQLAlchemy async engine; timeout 2s
- [ ] 2.4 Implement `langgraph_ready` probe — check checkpointer initialized and graph compiled
- [ ] 2.5 Implement `wa_socket_connected` probe — check gateway WebSocket state via internal API
- [ ] 2.6 Implement `tg_polling_active` probe — check last poll timestamp < 30s
- [ ] 2.7 Implement `ollama_available` probe — GET Ollama `/api/tags` with 3s timeout (optional, only if local models configured)

## 3. Health Orchestrator

> Spec: `specs/health-orchestrator/spec.md`
>
> Background loop that runs probes and updates service graph.
>
> **Priority: LOW** — Depends on §1, §2.

- [ ] 3.1 Create `src/brain/system/health.py` — `HealthOrchestrator` class: `__init__(graph, probe_registry, interval_seconds)`, `start()`, `stop()`, `run_cycle()`
- [ ] 3.2 Implement probe scheduling — `asyncio.gather` all probes with per-probe timeout; collect results
- [ ] 3.3 Implement result processing — pass probe results to `ServiceGraph` for state evaluation and cascade
- [ ] 3.4 Implement startup sequence — run initial blocking probe cycle before starting background loop
- [ ] 3.5 Log initial system health summary on startup
- [ ] 3.6 Add `system.probe_interval_seconds` config field to `nuvex.yaml` schema (default: 15)
- [ ] 3.7 Implement graceful error handling — orchestrator logs internal errors but never crashes

## 4. Diagnostic Engine & Auto-Recovery

> Spec: `specs/auto-recovery/spec.md`
>
> Pattern-match failures to recovery recipes and execute them.
>
> **Priority: LOW** — Depends on §3.

- [ ] 4.1 Create `src/brain/system/diagnostics.py` — `DiagnosticEngine` class: `diagnose(error) -> RecipeMatch | None`; match against registered patterns
- [ ] 4.2 Create `src/brain/system/recovery.py` — `SystemRecovery` class: `register(RecipeDefinition)`, `execute(recipe_id) -> RecoveryResult`, `get_history(limit) -> list[RecoveryRecord]`
- [ ] 4.3 Create `src/brain/system/recipes.py` — `RecipeDefinition` Pydantic model: `id`, `trigger_pattern`, `action`, `max_attempts`, `cooldown_seconds`
- [ ] 4.4 Implement `reconnect_db_pool` recipe — dispose SQLAlchemy engine, recreate, test connection
- [ ] 4.5 Implement `clear_stale_locks` recipe — release PostgreSQL advisory locks older than 5 min
- [ ] 4.6 Implement `restart_gateway_session` recipe — signal gateway to re-authenticate via internal API
- [ ] 4.7 Implement `clear_checkpoint_corruption` recipe — delete corrupted checkpoint by thread_id; log for review
- [ ] 4.8 Implement `reset_event_bus_backlog` recipe — drop oldest 50% of queued events; emit overflow warning
- [ ] 4.9 Implement cooldown and max_attempts enforcement — track per-recipe state; escalate when exhausted
- [ ] 4.10 Implement failure-to-recovery bridge — listen for `system.service_state_changed` → pass to diagnostic engine
- [ ] 4.11 Write recovery history to `system_recovery_log` table (id, recipe_id, triggered_by, timestamp, success, details, attempt_number)
- [ ] 4.12 Implement operator notification on recovery exhaustion — emit `system.recovery_exhausted`; send notification if channel configured

## 5. System API & Dashboard

> Spec: `specs/health-orchestrator/spec.md` (API section)
>
> REST endpoints for system health and recovery.
>
> **Priority: LOW** — Depends on §3, §4.

- [ ] 5.1 Create `src/brain/routers/system.py` — FastAPI router mounted at `/api/v1/system`
- [ ] 5.2 Implement `GET /api/v1/system/health` — full system health with all service states
- [ ] 5.3 Implement `GET /api/v1/system/graph` — serialised dependency graph for dashboard visualisation
- [ ] 5.4 Implement `GET /api/v1/system/health/{service}` — single service detail with probe history
- [ ] 5.5 Implement `GET /api/v1/system/recovery/log` — recovery history (last 100)
- [ ] 5.6 Implement `POST /api/v1/system/recovery/{recipe_id}/trigger` — manual recipe trigger; operator auth required; bypass cooldown

## 6. Integration & Config

> **Priority: LOW** — Wire everything into the brain server.

- [ ] 6.1 Add `system` section to `nuvex.yaml` schema — services, probe_interval_seconds
- [ ] 6.2 Register `HealthOrchestrator` in `src/brain/server.py` lifespan — start on startup, stop on shutdown
- [ ] 6.3 Create Alembic migration for `system_recovery_log` table
- [ ] 6.4 Wire diagnostic engine to listen for service state change events

## 7. Testing

> **Priority: LOW** — Verify graph correctness and recovery logic.

- [ ] 7.1 Write unit test: `ServiceGraph.load()` — valid config → correct DAG; circular dependency → error
- [ ] 7.2 Write unit test: state evaluation — all probes pass + deps healthy → healthy; probes pass + dep unhealthy → degraded
- [ ] 7.3 Write unit test: upstream cascade — postgres unhealthy → brain degraded → gateways degraded; postgres recovers → all healthy
- [ ] 7.4 Write unit test: `startup_order()` — returns topological order
- [ ] 7.5 Write unit test: `db_pool_active` probe — mock pool healthy → True; mock pool error → False
- [ ] 7.6 Write unit test: `DiagnosticEngine` — connection refused error → matches `reconnect_db_pool`; unknown error → undiagnosed
- [ ] 7.7 Write unit test: recipe execution — success → log + event; failure + max_attempts → escalate
- [ ] 7.8 Write unit test: cooldown enforcement — recipe applied → second trigger within cooldown → skipped
- [ ] 7.9 Write integration test: full orchestrator cycle — service goes unhealthy → cascade → recovery → healthy
- [ ] 7.10 Write integration test: API endpoints — system/health returns correct structure; manual trigger executes recipe
