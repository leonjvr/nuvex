## Context

Maya is an autonomous AI assistant currently running on OpenClaw (TypeScript, single container, prompt-based governance) on a Hetzner VPS. She handles WhatsApp, Telegram, and email across personal and group conversations. OpenClaw's governance is prompt-only — the model can ignore rules. SIDJUA (TypeScript) provides structural governance but lacks identity/personality features.

NUVEX replaces both. It's a new Python codebase built on LangGraph that reimplements SIDJUA's governance concepts as graph nodes, grafts OpenClaw's workspace/bootstrap identity system, and uses a multi-container architecture. The SIDJUA fork at `github.com/leonjvr/nuvex` serves as architectural reference — we are not extending its TypeScript code.

**Constraints:**
- Must run on a single Hetzner VPS (4 vCPU, 8GB RAM) alongside other services
- WhatsApp requires Baileys (Node.js only) — cannot be Python
- Must maintain Maya's existing WhatsApp number (Baileys credentials) and Telegram bot
- Zero downtime migration: run NUVEX alongside OpenClaw, cut over when stable
- All state in PostgreSQL — no SQLite, no file-based databases

## Goals / Non-Goals

**Goals:**
- Working agent brain (LangGraph + governance) that processes messages from any gateway
- Multi-container deployment with crash isolation per channel
- Workspace bootstrap injection giving agents personality/identity
- PostgreSQL+pgvector for all persistence including LangGraph checkpoints
- Model routing to reduce costs on simple replies
- Minimal viable dashboard for agent monitoring
- Maya migration path from OpenClaw

**Non-Goals:**
- Multi-server distributed deployment (single VPS for now)
- Multi-tenant SaaS (single-org, self-hosted)
- Visual workflow editor (LangGraph Studio handles this for dev)
- Mobile app
- Full Paperclip feature parity on day 1 (task board is minimal)
- Bubblewrap OS-level sandboxing (deferred — subprocess isolation first)

## Decisions

### 1. LangGraph Python as agent runtime

**Choice:** LangGraph `StateGraph` (Python) for agent reasoning and governance.

**Alternatives considered:**
- SIDJUA TypeScript runtime (extend directly) — governance already built but bespoke, no community, linear-only reasoning
- LangGraph JS — same primitives but 6 months behind, no Studio, smaller ecosystem
- CrewAI/AutoGen — less control over governance injection point

**Rationale:** LangGraph's `interrupt()` maps perfectly to approval gates. `PostgresSaver` gives us checkpointing for free. Conditional edges model the governance pipeline naturally. Python ecosystem has the best LLM library support.

### 2. Multi-container Docker architecture

**Choice:** 6 containers: `nuvex-brain`, `nuvex-gateway-wa`, `nuvex-gateway-tg`, `nuvex-gateway-mail`, `nuvex-db`, `nuvex-dashboard`.

**Alternatives considered:**
- Monolith (single container) — simpler to deploy, but WhatsApp crash takes down everything
- Two containers (Node.js gateway + Python brain) — viable but Telegram/email gateways add no value being in Node.js

**Rationale:** Crash isolation. WhatsApp gateway crashes (Baileys disconnects regularly) shouldn't affect Telegram. Brain is stateless so it can be restarted independently. Each gateway can be scaled/replaced independently. The operational overhead of 6 containers is manageable with Docker Compose.

### 3. Gateway communication pattern: synchronous REST

**Choice:** Gateways call brain via synchronous `POST /api/v1/invoke`. Brain blocks until response is ready.

**Alternatives considered:**
- Message queue (Redis/RabbitMQ) — async, better for high throughput, but adds operational complexity and another service
- WebSocket — bidirectional, but gateways are the initiators not subscribers
- gRPC — faster serialization, but REST is simpler to debug and test

**Rationale:** Volume is low (~100 messages/day). REST is simple, debuggable (curl), and the brain can use LangGraph's built-in `invoke()` directly. If latency becomes an issue, add streaming SSE endpoint (`/api/v1/invoke/stream`) — already specced. Queue-based can be added later as a Phase 2 upgrade without changing gateway code (just swap the endpoint).

### 4. Brain response with action dispatching

**Choice:** Brain returns structured `actions` array. Gateway processes its own channel's actions directly. Cross-channel actions are posted to a shared actions table in PostgreSQL, polled by target gateways.

**Alternatives considered:**
- Webhook callbacks — brain calls gateway endpoints to dispatch actions
- Redis pub/sub — real-time but adds a dependency

**Rationale:** Keep it simple. Cross-channel messaging (e.g., agent in WhatsApp thread sends Telegram message) is rare enough that PostgreSQL polling (1s interval) is fine. No extra infrastructure.

### 5. PostgreSQL + pgvector (single database)

**Choice:** Single PostgreSQL 16 instance with pgvector extension for everything.

**Alternatives considered:**
- PostgreSQL + separate Qdrant for vectors — better vector performance at scale
- PostgreSQL + Redis for caching — adds config surface

**Rationale:** Maya's vector corpus is small (<100K embeddings). pgvector handles this easily. One database to back up, one connection string, one migration system. Qdrant can be added later if vector search becomes a bottleneck.

### 6. Build own dashboard (no Paperclip fork)

**Choice:** Purpose-built FastAPI + React dashboard.

**Alternatives considered:**
- Fork Paperclip — get issue tracking free but inherit Node.js codebase and project-management-centric data model
- Keep Paperclip alongside NUVEX dashboard — two UIs, confusing

**Rationale:** NUVEX needs agent-centric UI (governance, conversations, workspace, costs). Paperclip covers ~20% of the need. Building from scratch means the UI reflects the actual data model. FastAPI backend shares models with the brain. MVP dashboard is minimal: agent list, audit log, conversation viewer, workspace editor.

### 7. divisions.yaml as single source of truth

**Choice:** All agent configuration in `divisions.yaml`. Brain, gateways, and dashboard all read from this file (or a shared database representation loaded from it).

**Alternatives considered:**
- Database-only config — editable from dashboard, but harder to version control
- Separate config per container — config drift risk

**Rationale:** File-based config is version-controllable (git), diffable, reviewable. Dashboard can read it for display. Future: dashboard edits write to yaml, commit to git. Same pattern SIDJUA uses, proven to work.

## Container Communication Diagram

```
                    ┌─────────────────┐
                    │   nuvex-db      │
                    │   PostgreSQL    │
                    │   + pgvector    │
                    └────────┬────────┘
                             │ SQL
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐ ┌───────────────┐ ┌─────────────────┐
│ nuvex-brain     │ │ nuvex-dashboard│ │ (future workers)│
│ :8100           │ │ :8200         │ │                 │
│ LangGraph       │ │ FastAPI+React │ │                 │
│ Governance      │ └───────────────┘ └─────────────────┘
│ Workspace       │
└────────┬────────┘
         │ REST API
    ┌────┼────────────────┐
    │    │                │
    ▼    ▼                ▼
┌──────┐ ┌──────┐  ┌──────────┐
│ gw-wa│ │ gw-tg│  │ gw-mail  │
│ :8101│ │ :8102│  │ :8103    │
│NodeJS│ │Python│  │ Python   │
└──────┘ └──────┘  └──────────┘
```

## Data Model (PostgreSQL tables)

```
agents              — agent definitions (loaded from divisions.yaml)
threads             — conversation threads (channel, participants, agent)
messages            — message history per thread
governance_audit    — SHA-256 chained audit trail
budgets             — per-agent, per-division budget tracking
tasks               — task board items (TaskPacket schema: priority, acceptance_criteria, parent_task_id, verification_level)
workspace_cache     — hot cache of workspace file contents (optional)
actions_queue       — cross-channel action dispatch
events              — structured event bus log (lane, status, failure_class, payload JSONB)
agent_lifecycle     — agent state transitions (agent_id, from_state, to_state, invocation_id, timestamp)
cron_entries        — scheduled task registry (name, schedule, agent, prompt, enabled, last_run, run_count)
service_health      — plugin/service health state history (service_name, health_state, error_rate, timestamp)
recovery_log        — recovery recipe execution history (scenario, step, action, result, timestamp)
```

LangGraph's `PostgresSaver` creates its own `checkpoints` and `checkpoint_blobs` tables automatically.

## Workspace Directory Layout (per agent)

```
/data/agents/<name>/workspace/
├── SOUL.md
├── IDENTITY.md
├── USER.md
├── AGENTS.md
├── TOOLS.md
├── HEARTBEAT.md
├── BOOTSTRAP.md       (first-run only, deleted after)
├── MEMORY.md          (curated long-term)
├── memory/
│   ├── 2026-04-05.md
│   └── 2026-04-04.md
├── contacts/
│   ├── people/
│   │   ├── leon.md
│   │   └── sarah.md
│   └── whatsapp-contacts.md
└── skills/
    ├── elevenlabs/
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   └── tts.sh
    │   └── .env
    └── dev-server/
        ├── SKILL.md
        └── scripts/
            └── provision.sh
```

## Key Subsystems (from claw-code analysis)

### Agent Lifecycle State Machine
Every agent instance progresses through: Spawning → TrustRequired → ReadyForPrompt → Running → Finished/Failed. The brain maintains an in-memory registry of all agent states. Concurrent invocations for the same agent are queued. State transitions emit events to the event bus.

### Session Compaction
When threads exceed a configurable message threshold (default: 50), older messages are summarized via the agent's fast model. The most recent N messages (default: 10) are preserved verbatim. Summaries use priority-based compression: tool results and decisions are retained first; filler is dropped first. Deduplication prevents repeated facts.

### Recovery Engine
Runtime failures are classified into 7 scenarios (LlmApiError, ToolExecutionTimeout, ToolExecutionCrash, GatewayDisconnect, DatabaseConnectionLost, OutOfBudget, ContextWindowOverflow). Each has a multi-step recovery recipe (retry → fallback → escalate). The recovery engine subscribes to failure events on the event bus and executes recipes automatically.

### Event Bus
8 event lanes route structured events between components. Events carry failure classification (transient/permanent/degraded/unknown). Persisted to PostgreSQL for audit. Subscribers: recovery engine, dashboard (real-time), budget tracker, plugin health monitor.

### Tool Hooks
PreToolUse hooks run after governance approval but before execution — can mutate inputs or abort. PostToolUse hooks run after execution for logging and side effects. Built-in hooks: AuditHook, CostTrackingHook, SendMessageHook. Custom hooks definable per-agent via config.

### Cron Registry
Structured cron scheduling replaces ad-hoc HEARTBEAT.md parsing. Cron expressions define schedules. HEARTBEAT.md entries are registered alongside divisions.yaml entries. Execution tracking, concurrency guards, manual triggers via API.

### Policy Engine
The governance pipeline's policy stage uses composable AND/OR conditions (tool_matches, time_outside, calls_in_window, budget_above_pct, etc.) with actions (approve, deny, escalate, warn, throttle). Evaluated per-scope: agent > division > global. First match wins.

### Plugin Health
LLM providers, gateways, and external APIs tracked as Healthy/Degraded/Failed. Health-aware model routing: if the primary model's provider is Failed, auto-fallback. Gateway health aggregated via /health endpoints.

## Risks / Trade-offs

**[Risk] LangGraph Python maturity** — LangGraph is actively developed; breaking changes between versions possible.
→ Mitigation: Pin to a specific LangGraph version. Use `uv.lock` for deterministic builds. Run integration tests on upgrade.

**[Risk] Baileys WhatsApp instability** — Baileys is an unofficial library. WhatsApp can break it anytime via protocol changes.
→ Mitigation: Same risk as current OpenClaw. Gateway isolation means a Baileys outage only affects WhatsApp. Telegram remains operational. Monitor upstream Baileys repo for breakage.

**[Risk] 6 containers on a single VPS** — Memory pressure on 8GB RAM.
→ Mitigation: Brain and gateways are lightweight (~200MB each). PostgreSQL is the heaviest (~1GB with data). Total estimated: ~3GB. Still leaves 5GB headroom. Monitor and scale VPS vertically if needed.

**[Risk] Synchronous REST for long-running agent tasks** — If the agent reasons for 30+ seconds, the HTTP connection stays open.
→ Mitigation: Use streaming SSE endpoint for long tasks. Set gateway timeout to 120s. Brain can also accept async pattern: return 202 + poll for result.

**[Risk] Single-database SPOF** — PostgreSQL is the only stateful service.
→ Mitigation: Daily `pg_dump` backups to off-server storage. WAL archiving for point-in-time recovery. For HA, add a standby replica (Phase 2).

**[Trade-off] Two languages (Python + Node.js)** — Adds cognitive overhead.
→ Accepted: Node.js is isolated to the WhatsApp gateway (~200 lines). Everything else is Python. The gateway is a thin adapter with minimal logic.

## Migration Plan

1. Deploy NUVEX containers alongside existing OpenClaw (different ports)
2. Import Maya's config: `openclaw.json` → `divisions.yaml`
3. Copy workspace files: `openclawchanges/workspace/*.md` → `/data/agents/maya/workspace/`
4. Mount Baileys credentials from existing path into `nuvex-gateway-wa`
5. Set up Telegram bot token in `nuvex-gateway-tg` config
6. Run smoke tests: send test messages on each channel
7. Cut port bindings from OpenClaw to NUVEX (swap `NETBIRD_IP` bindings)
8. Monitor for 48 hours
9. Decommission OpenClaw container

**Rollback:** At any point before step 7, revert by stopping NUVEX containers. After step 7, rollback = swap port bindings back to OpenClaw. OpenClaw container stays available until step 9.

## Open Questions

1. **Dashboard frontend framework** — React, Vue, or Svelte? Leaning React for ecosystem size and LangGraph's existing React components. Needs decision before dashboard implementation.
2. **Audio/voice handling** — Currently OpenClaw uses Groq for STT and ElevenLabs for TTS via shell scripts. Should these become brain-level tools or remain as skill scripts? Leaning: keep as skill scripts.
3. ~~**Heartbeat/proactive tasks**~~ — **RESOLVED**: Internal `apscheduler` cron registry in the brain. HEARTBEAT.md entries are parsed and registered alongside `divisions.yaml` cron entries. See `cron-registry` spec.
