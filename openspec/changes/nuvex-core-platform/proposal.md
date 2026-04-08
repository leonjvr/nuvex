## Why

Autonomous AI agents need both structural governance (hard limits that models cannot bypass) and rich identity (personality, memory, skills). SIDJUA provides the best governance-by-architecture model; OpenClaw provides the best agent identity system. Neither alone is sufficient. We build a new platform — NUVEX — that reimplements SIDJUA's governance concepts as a LangGraph Python graph, grafts OpenClaw's workspace/bootstrap identity system on top, uses a multi-container architecture for crash isolation and horizontal scaling, and provides its own purpose-built dashboard for agent operations.

## What Changes

- **LangGraph Python agent runtime** — Reimplement SIDJUA's 5-stage governance pipeline (Forbidden → Approval → Budget → Classification → Policy) as LangGraph graph nodes with conditional edges. Uses `PostgresSaver` for checkpointing, `interrupt()` for human-in-the-loop approval gates
- **Multi-container architecture** — Separate Docker containers per concern: brain (Python/LangGraph), gateway-wa (Node.js/Baileys), gateway-tg (Python), gateway-mail (Python), database (PostgreSQL+pgvector), dashboard (Python/FastAPI + frontend)
- **Workspace bootstrap injection** — Every agent gets a `workspace/` directory (SOUL.md, AGENTS.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, MEMORY.md, skills/, contacts/) injected into the system prompt between governance preamble and task context
- **PostgreSQL+pgvector** — Single database for all persistence: LangGraph checkpoints, governance audit trail, task queue, agent state, budget tracking, semantic memory vectors
- **Model router** — Route tasks to different models by complexity (fast model for acks, primary for conversation, code model for dev tasks)
- **Skill architecture** — Per-skill directories with SKILL.md manifests, executable scripts, per-skill .env configs
- **Memory continuity** — Daily memory files + curated MEMORY.md, protected from context trimming
- **Contact discipline** — `contacts/people/` files prevent hallucinated phone numbers
- **NUVEX Dashboard** — Purpose-built web UI for agent operations: governance logs, conversation threads, workspace file editor, cost analytics, agent config. Replaces Paperclip
- **Unified gateway API** — All messaging gateways speak the same REST contract to the brain service
- **Agent lifecycle state machine** — Every agent instance progresses through defined states (Spawning → TrustRequired → ReadyForPrompt → Running → Finished/Failed) with structured events on every transition
- **Session compaction** — Automatic summarization of old conversation messages when threads exceed a threshold, preserving recent messages verbatim while compressing older history
- **Recovery recipes** — Classified failure scenarios (LLM errors, tool crashes, gateway disconnects, context overflow) with automatic multi-step recovery before human escalation
- **Structured event bus** — Internal event routing across lanes (agent.lifecycle, tool.execution, governance.decision, llm.invocation, etc.) with failure classification (transient/permanent/degraded)
- **Pre/post tool hooks** — Interceptors before and after tool execution for input mutation, output logging, permission overrides, and custom side effects
- **Cron registry** — Structured scheduling system for recurring agent tasks, replacing ad-hoc HEARTBEAT.md interpretation with cron expressions, tracking, and concurrency guards
- **Task packets** — Structured work assignments for sub-agent delegation with acceptance criteria, priority, lifecycle tracking, and parent-child decomposition
- **Green contract verification** — Graduated task completion verification levels (SelfReported → OutputValidated → ConstraintsMet → PeerReviewed → IntegrationVerified) tied to agent trust tiers
- **Composable policy engine** — Rule-based policy evaluation with AND/OR conditions, rate limiting, time windows, and per-scope precedence (agent > division > global)
- **Plugin/service health tracking** — Real-time health state monitoring (Healthy/Degraded/Failed) for LLM providers, gateways, and external APIs with health-aware model routing

## Capabilities

### New Capabilities
- `langgraph-brain`: LangGraph StateGraph agent runtime with governance pipeline as graph nodes, tool execution with governed ToolNode, multi-turn reasoning loop, model routing, workspace bootstrap injection. FastAPI server exposing /api/v1/invoke.
- `gateway-architecture`: Multi-container messaging gateway system. Each channel (WhatsApp, Telegram, Email) in its own container. Unified REST API contract. Crash isolation. Horizontal scaling per-channel.
- `workspace-bootstrap`: Workspace directory per agent with identity/personality files injected into system prompts. Covers SOUL.md, AGENTS.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md loading and injection.
- `governance-pipeline`: 5-stage pre-action enforcement reimplemented as LangGraph nodes: forbidden check → approval gate (interrupt()) → budget check → classification → policy eval. SHA-256 audit chain in PostgreSQL.
- `postgresql-storage`: PostgreSQL+pgvector for all persistence — LangGraph checkpoints (PostgresSaver), governance audit trail, task queue, agent state, budget tracking, semantic memory vectors.
- `model-routing`: Per-agent model routing by task complexity. Maps task types (simple_reply, conversation, code_generation, voice_response) to model tiers (primary, fast, code).
- `skill-system`: Per-skill directories with SKILL.md manifests, scripts/, .env configs. Skills discovered from workspace, SKILL.md content injected into agent context.
- `memory-continuity`: Daily memory files + curated MEMORY.md. Memory sections protected from context window trimming. Lifecycle management.
- `contact-management`: Contact files in `contacts/people/` with structured fields. Refresh script mines message logs. Hard rule: never guess numbers.
- `nuvex-dashboard`: Purpose-built web UI — agent status/config, governance audit log viewer, conversation thread viewer, workspace file editor, cost analytics, task board. FastAPI backend + modern frontend.
- `openclaw-migration`: Import tool for existing OpenClaw deployments. Maps `openclaw.json` → `divisions.yaml`, copies workspace files, migrates credentials.
- `agent-lifecycle`: Agent lifecycle state machine (Spawning → TrustRequired → ReadyForPrompt → Running → Finished/Failed). In-memory agent registry. Lifecycle events emitted on every transition. Queued concurrent invocations.
- `session-compaction`: Automatic conversation thread compaction when message count exceeds threshold. Priority-based summary compression retaining tool results and decisions over filler. Deduplication. Configurable per-agent. Uses fast model for cost efficiency.
- `recovery-recipes`: Classified failure scenarios (LlmApiError, ToolExecutionTimeout, ToolExecutionCrash, GatewayDisconnect, DatabaseConnectionLost, OutOfBudget, ContextWindowOverflow) with multi-step recovery recipes and escalation. Configurable retry counts and delays.
- `event-bus`: Internal structured event bus with lanes (agent.lifecycle, gateway.routing, tool.execution, governance.decision, llm.invocation, recovery.action, plugin.health, cron.execution). Failure classification (transient/permanent/degraded/unknown). Event persistence and subscriber system.
- `tool-hooks`: Pre-tool and post-tool execution hooks. PreToolUse can mutate inputs or abort. PostToolUse for logging and side effects. Built-in hooks (audit, cost tracking, send_message routing). Custom hooks via configuration with tool pattern matching.
- `cron-registry`: Structured cron scheduling with cron expressions, per-agent task definitions, execution tracking (run_count, last_status), CRUD API, manual trigger, concurrency guard. Integrates with HEARTBEAT.md.
- `task-packets`: Structured task delegation between agents. TaskPacket schema with priority, acceptance criteria, lifecycle tracking (pending → accepted → in_progress → completed/failed). Per-agent task queues. Parent-child decomposition.
- `green-contract`: Graduated verification levels for task completion (SelfReported → OutputValidated → ConstraintsMet → PeerReviewed → IntegrationVerified). Minimum level enforced per trust tier. Acceptance criteria checking.
- `policy-engine`: Composable policy rules with AND/OR conditions (tool_matches, input_contains, time_outside, calls_in_window, budget_above_pct, etc.). Actions: approve, deny, escalate, warn, throttle. Scoped evaluation: agent > division > global.
- `plugin-health`: Service health tracking (Healthy/Degraded/Failed) for LLM providers, gateways, and external APIs. Health-aware model routing. Health status API. Dashboard health panel. Gateway health aggregation.

### Modified Capabilities
_(None — this is a new codebase, not modifications to SIDJUA)_

## Impact

- **New Python codebase**: `src/brain/` (LangGraph runtime), `src/gateway/` (channel adapters), `src/dashboard/` (web UI), `src/shared/` (config, models)
- **SIDJUA fork becomes reference**: The forked TypeScript repo is architectural reference. NUVEX is a clean Python implementation of the same governance concepts
- **Dependencies**: `langgraph`, `langchain-core`, `langchain-openai`, `langchain-anthropic`, `psycopg`, `pgvector`, `fastapi`, `uvicorn`, `pydantic`, `apscheduler` (cron scheduling), `croniter` (cron expression parsing)
- **Node.js**: Only for `gateway-wa` (Baileys). All other containers are Python
- **Docker**: 6 containers — brain, gateway-wa, gateway-tg, gateway-mail, db, dashboard
- **Paperclip**: Replaced by nuvex-dashboard. No longer deployed
- **Config schema**: `divisions.yaml` with workspace paths, model routing, skill declarations, channel configs per-agent
