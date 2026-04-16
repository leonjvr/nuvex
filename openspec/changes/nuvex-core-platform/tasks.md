## 1. Project Scaffolding

- [x] 1.1 Create Python project structure: `src/brain/`, `src/gateway/`, `src/dashboard/`, `src/shared/`, `tests/`
- [x] 1.2 Write `pyproject.toml` with dependencies: langgraph, langchain-core, langchain-openai, langchain-anthropic, fastapi, uvicorn, psycopg[binary], pgvector, pydantic, alembic, python-telegram-bot, aiosmtplib, aioimaplib, apscheduler, croniter
- [x] 1.3 Create `uv.lock` for deterministic builds (`uv lock`)
- [x] 1.4 Write `Dockerfile.brain` (Python 3.12, uv install, FastAPI entrypoint)
- [x] 1.5 Write `Dockerfile.gateway-wa` (Node.js 20, Baileys, minimal adapter)
- [x] 1.6 Write `Dockerfile.gateway-tg` (Python 3.12, python-telegram-bot)
- [x] 1.7 Write `Dockerfile.gateway-mail` (Python 3.12, IMAP/SMTP)
- [x] 1.8 Write `Dockerfile.dashboard` (Python 3.12 + Node for frontend build)
- [x] 1.9 Write `docker-compose.yml` with all 6 containers, nuvex-net network, named volumes, env_file
- [x] 1.10 Write `.env.example` with all required environment variables
- [x] 1.11 Update repo `README.md` with NUVEX branding, architecture diagram, quickstart

## 2. Shared Configuration & Models

- [x] 2.1 Define `src/shared/config.py` — load and validate `divisions.yaml` with Pydantic models (AgentDefinition, ModelConfig, RoutingConfig, ChannelConfig, BudgetConfig)
- [x] 2.2 Define `src/shared/models.py` — shared Pydantic models: InvokeRequest, InvokeResponse, ActionItem, HealthResponse
- [x] 2.3 Define `src/shared/schema.py` — SQLAlchemy/Pydantic models for database tables (agents, threads, messages, governance_audit, budgets, tasks, actions_queue)
- [x] 2.4 Write a sample `divisions.yaml` for Maya with all config fields populated (agent, models, workspace, skills, channels, budget, tier)

## 3. Database Layer

- [x] 3.1 Set up Alembic with `alembic init` in `src/brain/migrations/`
- [x] 3.2 Write initial migration: create `agents`, `threads`, `messages` tables
- [x] 3.3 Write migration: create `governance_audit` table with SHA-256 hash column and prev_hash foreign reference
- [x] 3.4 Write migration: create `budgets` table (per-agent, per-division, daily/monthly/per-task limits)
- [x] 3.5 Write migration: create `tasks` table (TaskPacket schema: task_id, parent_task_id, title, description, assigned_agent, delegated_by, priority, deadline, acceptance_criteria JSONB, context JSONB, status, verification_level)
- [x] 3.6 Write migration: create `actions_queue` table (cross-channel action dispatch with status and target_channel)
- [x] 3.6a Write migration: create `events` table (event bus: id, lane, status, failure_class, agent_id, invocation_id, timestamp, payload JSONB)
- [x] 3.6b Write migration: create `agent_lifecycle` table (agent_id, from_state, to_state, invocation_id, timestamp)
- [x] 3.6c Write migration: create `cron_entries` table (name, schedule, agent, prompt, enabled, channel, target, last_run, next_run, run_count, last_status)
- [x] 3.6d Write migration: create `service_health` table (service_name, health_state, error_rate_pct, last_check, last_state_change)
- [x] 3.6e Write migration: create `recovery_log` table (scenario, step, action_taken, result, agent_id, invocation_id, timestamp)
- [x] 3.7 Write migration: enable `pgvector` extension and create `memories` table with `vector(1536)` column
- [x] 3.8 Write `src/brain/db.py` — async database connection pool (psycopg async), session factory, DATABASE_URL resolution (divisions.yaml → env var → error)
- [x] 3.9 Configure LangGraph `PostgresSaver` to use the same database connection
- [x] 3.10 Write startup logic: run Alembic migrations on brain boot, exit on failure

## 4. Brain Core — LangGraph Runtime

- [x] 4.1 Define `src/brain/state.py` — typed agent state (TypedDict or Pydantic): messages, agent_id, thread_id, channel, governance_decisions, tokens_used, cost_used, workspace_config, active_tools
- [x] 4.2 Implement `src/brain/graph.py` — build LangGraph `StateGraph` with nodes: route_model → call_llm → govern_tools → execute_tools → (loop back or end)
- [x] 4.3 Implement `src/brain/nodes/call_llm.py` — LLM invocation node that selects model from routing result, calls via langchain ChatModel, returns tool_calls or final response
- [x] 4.4 Implement `src/brain/nodes/execute_tools.py` — GovernedToolNode that intercepts tool calls, runs each through governance subgraph, executes approved calls, returns denial messages for rejected calls
- [x] 4.5 Implement the multi-turn reasoning loop: conditional edge from execute_tools back to call_llm when tool results exist, end when LLM returns final text or max_turns reached
- [x] 4.6 Implement thread state persistence: load from PostgresSaver on invoke, save after completion, keyed by thread_id
- [x] 4.7 Implement `src/brain/server.py` — FastAPI app with `POST /api/v1/invoke`, `GET /api/v1/agents`, `GET /api/v1/agents/{id}/status`, `GET /health`
- [x] 4.8 Implement `POST /api/v1/invoke` handler: validate request, load agent config, build graph, invoke with message, return structured response
- [x] 4.9 Implement `POST /api/v1/invoke/stream` — SSE streaming endpoint using LangGraph `.astream()`
- [x] 4.10 Implement `GET /health` — check PostgreSQL connection, return status
- [x] 4.11 Write `src/brain/__main__.py` — uvicorn entrypoint, run migrations, load divisions.yaml, start server

## 5. Workspace Bootstrap

- [x] 5.1 Implement `src/brain/workspace.py` — load bootstrap files from agent's workspace directory in specified order (SOUL.md → IDENTITY.md → USER.md → AGENTS.md → TOOLS.md → HEARTBEAT.md)
- [x] 5.2 Implement skill discovery: scan `workspace/skills/*/SKILL.md`, parse YAML frontmatter, collect skill content for injection
- [x] 5.3 Implement memory loading: load MEMORY.md (DM sessions only) + today's and yesterday's daily memory files from `memory/`
- [x] 5.4 Assemble full system prompt: governance preamble + bootstrap files + skill contents + memory, in the specified injection order
- [x] 5.5 Implement context window trimming: calculate token count, trim daily memory files (oldest first) → MEMORY.md → HEARTBEAT/TOOLS/AGENTS → never trim SOUL.md or governance
- [x] 5.6 Implement BOOTSTRAP.md first-run protocol: detect file, include in first prompt, delete after successful first run
- [x] 5.7 Implement workspace hot-reload: re-read files from disk on each invocation (no caching between calls)

## 6. Governance Pipeline

- [x] 6.1 Implement `src/brain/governance/forbidden.py` — forbidden check node: match action against forbidden list from agent config, hard-block if matched
- [x] 6.2 Implement `src/brain/governance/approval.py` — approval gate node: check if action requires approval for agent's tier, call `interrupt()` to pause graph, send approval request
- [x] 6.3 Implement `src/brain/governance/budget.py` — budget check node: query `budgets` table, compare accumulated cost against per-task and per-agent limits, block if exceeded
- [x] 6.4 Implement `src/brain/governance/classification.py` — classification node: verify data classification matches agent's tier, block cross-division access
- [x] 6.5 Implement `src/brain/governance/policy.py` — policy evaluation node: apply custom rules (API frequency, time windows) from agent config
- [x] 6.6 Compose governance subgraph: chain 5 nodes with conditional edges (any denial short-circuits to end)
- [x] 6.7 Implement SHA-256 audit chain: on every governance decision, insert row into `governance_audit` with hash of (prev_hash + current entry data)
- [x] 6.8 Implement `nuvex audit verify` CLI command: walk the SHA-256 chain and report broken links
- [x] 6.9 Implement tier-based trust routing: T1 skips approval gate, T2 requires approval for destructive actions, T3 requires approval for all tool calls

## 7. Model Routing

- [x] 7.1 Implement `src/brain/routing/classifier.py` — pre-LLM task classifier: heuristics on message length (<50 tokens → simple_reply), code keywords → code_generation, default → conversation
- [x] 7.2 Implement `src/brain/routing/router.py` — select model tier based on classification result and agent's routing config from divisions.yaml
- [x] 7.3 Implement route_model graph node: classify task, select model, set model in agent state for call_llm node to use
- [x] 7.4 Implement cost tracking: after each LLM call, record token count, actual cost, and savings vs primary model in `budgets` table

## 8. Tool Execution

- [x] 8.1 Implement `src/brain/tools/executor.py` — subprocess tool executor with timeout, working directory isolation, restricted environment variables
- [x] 8.2 Implement skill script execution: load skill's `.env`, run script via subprocess with the merged environment
- [x] 8.3 Register built-in tools: exec (subprocess), read_file, write_file, web_fetch, send_message (to actions_queue)
- [x] 8.4 Implement tool filtering: only expose tools relevant to the agent's configured skills and tier

## 9. WhatsApp Gateway

- [x] 9.1 Create `src/gateway/whatsapp/` Node.js project with package.json and Baileys dependency
- [x] 9.2 Implement Baileys connection manager: connect using mounted credentials volume, auto-reconnect on disconnect
- [x] 9.3 Implement message handler: receive DM and group messages, format InvokeRequest, POST to brain /api/v1/invoke
- [x] 9.4 Implement reply handler: parse InvokeResponse, send reply via Baileys
- [x] 9.5 Implement audio message detection: detect voice notes, include `[Audio]` marker and transcript in metadata
- [x] 9.6 Implement cross-channel action polling: poll `actions_queue` table (or brain endpoint) for outbound WhatsApp messages from other channels
- [x] 9.7 Implement health endpoint: `GET /health` returning connection status, last message time, uptime

## 10. Telegram Gateway

- [x] 10.1 Create `src/gateway/telegram/` Python package
- [x] 10.2 Implement Telegram bot connection: connect via bot token, register message handlers for DMs and group mentions
- [x] 10.3 Implement message handler: format InvokeRequest, POST to brain /api/v1/invoke, send reply
- [x] 10.4 Implement approval request UI: send inline keyboard (Approve/Deny) when governance interrupts, forward decision back to brain to resume graph
- [x] 10.5 Implement cross-channel action polling: poll for outbound Telegram messages from other channels
- [x] 10.6 Implement health endpoint: `GET /health`

## 11. Email Gateway

- [x] 11.1 Create `src/gateway/email/` Python package
- [x] 11.2 Implement IMAP poller: connect to configured IMAP host, poll for new emails at configurable interval
- [x] 11.3 Implement inbound handler: parse email body, format InvokeRequest with `channel: "email"`, POST to brain
- [x] 11.4 Implement outbound SMTP sender: send emails when brain returns email actions
- [x] 11.5 Implement health endpoint: `GET /health`

## 12. Dashboard — Backend

- [x] 12.1 Create `src/dashboard/` Python package with FastAPI app
- [x] 12.2 Implement `GET /api/agents` — list all agents with status, tier, budget usage, active thread count
- [x] 12.3 Implement `GET /api/agents/{id}` — agent details including model config, division, last activity
- [x] 12.4 Implement `GET /api/audit` — paginated, filterable governance audit log (by agent, decision, date range)
- [x] 12.5 Implement `GET /api/threads` — list conversation threads with filters (channel, agent, date)
- [x] 12.6 Implement `GET /api/threads/{id}/messages` — full message history for a thread
- [x] 12.7 Implement `GET /api/workspace/{agent_id}/files` — list workspace files for an agent
- [x] 12.8 Implement `GET /api/workspace/{agent_id}/files/{path}` and `PUT` — read and write workspace files
- [x] 12.9 Implement `GET /api/costs` — cost analytics: per-agent, per-model, routing savings, projections
- [x] 12.10 Implement `GET /api/tasks` and `POST /api/tasks` — task board CRUD with TaskPacket schema and verification_level
- [x] 12.11 Implement `GET /api/events` — paginated event bus log with lane/status/agent filters
- [x] 12.12 Implement `GET /api/v1/health/services` — list all tracked services with health state
- [x] 12.13 Implement `GET /api/v1/cron` and CRUD endpoints — cron entry management and manual trigger

## 13. Dashboard — Frontend

- [x] 13.1 Initialize React (Vite) project in `src/dashboard/frontend/`
- [x] 13.2 Build layout shell: sidebar navigation, header with agent selector
- [x] 13.3 Build agent overview page: agent cards with status, budget gauge, activity sparkline
- [x] 13.4 Build governance audit page: filterable table with agent, action, decision, stage columns
- [x] 13.5 Build conversation viewer: thread list + message detail pane with tool calls and governance annotations
- [x] 13.6 Build workspace editor: file tree + Monaco/CodeMirror editor for .md files, save button
- [x] 13.7 Build cost analytics page: charts for daily/monthly spend, per-model breakdown, routing savings
- [x] 13.8 Build task board page: kanban or list view with create/edit/status-change, verification level badges
- [x] 13.9 Build event stream page: real-time event bus viewer grouped by lane with failure classification
- [x] 13.10 Build service health panel: dashboard widget with Healthy/Degraded/Failed indicators per service
- [x] 13.11 Build cron management page: cron entry list with schedule, last_run, next_run, manual trigger button
- [x] 13.12 Build agent lifecycle timeline: visual timeline of agent state transitions per invocation

## 14. OpenClaw Migration

- [x] 14.1 Implement `src/shared/migration/import_openclaw.py` — CLI entry: `nuvex import openclaw`
- [x] 14.2 Implement openclaw.json → divisions.yaml mapping: channels, model config, plugin paths → agent definition
- [x] 14.3 Implement workspace file copy: copy all .md bootstrap files and skills/ directory from OpenClaw workspace to NUVEX agent workspace
- [x] 14.4 Implement Baileys credential mapping: detect OpenClaw credential path, configure volume mount in docker-compose
- [x] 14.5 Implement `--dry-run` flag: display generated divisions.yaml without writing files
- [x] 14.6 Implement API key listing: scan OpenClaw .env, list keys that need manual transfer to NUVEX .env

## 15. Docker & Deployment

- [x] 15.1 Finalize docker-compose.yml: all 6 containers, nuvex-net bridge network, named volumes for db data / Baileys creds / workspace, env_file references, health checks, restart policies
- [x] 15.2 Configure Netbird IP binding: services bind to `${NETBIRD_IP}` with `127.0.0.1` fallback (no `0.0.0.0`)
- [x] 15.3 Write `scripts/deploy-nuvex.sh` — build images, push to server, bring up docker-compose
- [x] 15.4 Write `scripts/provision-nuvex.sh` — install prerequisites on fresh Hetzner VPS (Docker, Netbird, PostgreSQL client tools)
- [x] 15.5 Configure daily `pg_dump` backup to off-server storage
- [x] 15.6 Update `deployments/nuvex/` in openclaw-deployer with final docker-compose and deployment README

## 17. Agent Lifecycle

- [x] 17.1 Define lifecycle states enum: Spawning, TrustRequired, ReadyForPrompt, Running, Finished, Failed
- [x] 17.2 Implement `src/brain/lifecycle.py` — AgentLifecycleManager with state machine, transition validation, event emission
- [x] 17.3 Implement in-memory agent registry: track current state per agent, queued invocation count, last_state_change
- [x] 17.4 Implement invocation queuing: if agent is Running, queue the invocation; process when Finished/Failed
- [x] 17.5 Wire lifecycle transitions into brain graph: set Spawning on invoke start, Running before LLM call, Finished/Failed on completion
- [x] 17.6 Persist lifecycle events to `agent_lifecycle` table
- [x] 17.7 Expose lifecycle state in `GET /api/v1/agents/{id}/status` response

## 18. Session Compaction

- [x] 18.1 Define compaction config schema in divisions.yaml: threshold, preserve_recent, summary_max_tokens, mode
- [x] 18.2 Implement `src/brain/compaction.py` — CompactionEngine: detect threads over threshold, select messages to summarize, preserve recent N
- [x] 18.3 Implement priority-based summary prompt: instruct LLM to retain tool results > decisions > facts > context > filler
- [x] 18.4 Implement deduplication: detect repeated facts across messages being summarized
- [x] 18.5 Implement compaction model selection: use fast model if configured, fall back to primary
- [x] 18.6 Wire auto-compaction into brain graph: check before prompt assembly, compact if over threshold
- [x] 18.7 Implement manual compaction API: `POST /api/v1/threads/{id}/compact`
- [x] 18.8 Write integration test: thread with 60 messages compacts to summary + 10 recent

## 19. Recovery Recipes

- [x] 19.1 Define failure scenario enum: LlmApiError, ToolExecutionTimeout, ToolExecutionCrash, GatewayDisconnect, DatabaseConnectionLost, OutOfBudget, ContextWindowOverflow
- [x] 19.2 Implement `src/brain/recovery.py` — RecoveryEngine: classify failures, look up recipe, execute steps sequentially
- [x] 19.3 Implement recovery steps: retry_with_delay, switch_fallback_model, retry_with_extended_timeout, skip_tool, reconnect_gateway, trigger_compaction
- [x] 19.4 Implement escalation: notify operator via Telegram on recovery exhaustion, halt on database loss
- [x] 19.5 Wire recovery into event bus: subscribe to failure events, auto-trigger recipes
- [x] 19.6 Implement configurable recovery params in divisions.yaml: llm_retries, retry_delay, timeout_multiplier, reconnect_delays
- [x] 19.7 Persist recovery attempts to `recovery_log` table
- [x] 19.8 Write integration test: LLM rate limit triggers retry then fallback model

## 20. Event Bus

- [x] 20.1 Define event schema: NuvexEvent (id, lane, status, failure_class, agent_id, invocation_id, timestamp, payload)
- [x] 20.2 Implement `src/brain/events.py` — EventBus: in-process pub/sub with lane-based routing, sync and async subscribers
- [x] 20.3 Define event lanes: agent.lifecycle, gateway.routing, tool.execution, governance.decision, llm.invocation, recovery.action, plugin.health, cron.execution
- [x] 20.4 Implement failure classification logic: map HTTP status codes and exception types to transient/permanent/degraded/unknown
- [x] 20.5 Implement event persistence: write events to `events` table in PostgreSQL
- [x] 20.6 Implement event retention: configurable TTL (default 30 days), background cleanup job
- [x] 20.7 Wire event emission into all brain components: tool executor, LLM caller, governance, lifecycle
- [x] 20.8 Write integration test: tool failure emits event to bus, recovery engine receives it

## 21. Tool Hooks

- [x] 21.1 Define hook types: PreToolUse, PostToolUse with HookEvent schema (tool_name, tool_input, tool_output, agent_id, status, duration_ms)
- [x] 21.2 Implement `src/brain/hooks.py` — HookRunner: load hooks from config, execute in order, handle timeouts
- [x] 21.3 Implement built-in AuditHook (PostToolUse): emit tool.execution event to event bus
- [x] 21.4 Implement built-in CostTrackingHook (PostToolUse): accumulate LLM costs from tool results
- [x] 21.5 Implement built-in SendMessageHook (PostToolUse): route send_message tool outputs to actions_queue
- [x] 21.6 Implement PreToolUse input mutation: if hook returns modified input, use it for execution
- [x] 21.7 Implement PreToolUse abort: if hook returns abort signal, skip tool and return error to agent
- [x] 21.8 Implement custom hook loading from divisions.yaml: tool_pattern matching, script execution
- [x] 21.9 Implement hook timeout: kill hooks exceeding 5s timeout, continue execution
- [x] 21.10 Wire hooks into GovernedToolNode: PreToolUse after governance, PostToolUse after execution

## 22. Cron Registry

- [x] 22.1 Define cron entry schema: name, schedule (cron expr), agent, prompt, enabled, channel, target
- [x] 22.2 Implement `src/brain/cron.py` — CronRegistry: load entries from divisions.yaml + HEARTBEAT.md, store in DB
- [x] 22.3 Implement scheduler using `apscheduler`: register cron jobs, fire at scheduled times
- [x] 22.4 Implement HEARTBEAT.md parser: extract structured task definitions, register in cron registry
- [x] 22.5 Implement execution tracking: update last_run, run_count, last_status after each execution
- [x] 22.6 Implement concurrency guard: skip execution if previous run still active
- [x] 22.7 Implement cron CRUD API: GET/POST/PUT/DELETE /api/v1/cron, POST /api/v1/cron/{name}/trigger
- [x] 22.8 Emit cron.execution events to event bus on each run
- [x] 22.9 Write integration test: cron fires on schedule, invokes agent, records execution

## 23. Task Packets

- [x] 23.1 Define TaskPacket Pydantic model: task_id, parent_task_id, title, description, assigned_agent, delegated_by, priority, deadline, acceptance_criteria, context, status
- [x] 23.2 Implement task creation and validation in `src/brain/tasks.py`: validate agent exists, priority valid, title non-empty
- [x] 23.3 Implement task lifecycle transitions: pending → accepted → in_progress → completed/failed/cancelled
- [x] 23.4 Implement per-agent task queue: priority-ordered task retrieval
- [x] 23.5 Implement parent-child relationships: parent cannot complete until all children complete/cancel
- [x] 23.6 Register `create_task` and `complete_task` as built-in tools available to agents
- [x] 23.7 Write integration test: agent creates sub-task, child completes, parent notified

## 24. Green Contract (Verification Levels)

- [x] 24.1 Define verification level enum: SelfReported, OutputValidated, ConstraintsMet, PeerReviewed, IntegrationVerified
- [x] 24.2 Implement verification assessment in `src/brain/verification.py`: check acceptance criteria, validate output existence
- [x] 24.3 Implement minimum verification level per tier: T1=SelfReported, T2=OutputValidated, T3=PeerReviewed
- [x] 24.4 Implement acceptance criteria checker: parse criteria strings, evaluate file existence / string presence checks
- [x] 24.5 Wire verification into task completion: auto-advance level based on checks, block if below tier minimum
- [x] 24.6 Implement peer review routing: T3 tasks sent to operator for approval before final completion
- [x] 24.7 Display verification level badges in dashboard task board

## 25. Policy Engine

- [x] 25.1 Define policy rule schema: name, condition (and/or/leaf), action (approve/deny/escalate/warn/throttle), message
- [x] 25.2 Implement condition evaluator in `src/brain/governance/policy_engine.py`: tool_matches, input_contains, agent_tier, channel, time_outside, time_within, calls_in_window, budget_above_pct
- [x] 25.3 Implement AND/OR condition composition: recursive evaluation with short-circuit
- [x] 25.4 Implement policy actions: approve (skip remaining), deny (block), escalate (force approval gate), warn (allow + log), throttle (delay)
- [x] 25.5 Implement scoped policy loading: agent-level > division-level > global-level, first match wins
- [x] 25.6 Implement calls_in_window rate limiting: query recent events to count calls within window
- [x] 25.7 Replace existing policy node (6.5) with policy engine evaluation
- [x] 25.8 Write integration test: time-based policy denies after-hours deployment, rate limit blocks 11th call

## 26. Plugin / Service Health

- [x] 26.1 Define health state enum: Healthy, Degraded, Failed with transition thresholds
- [x] 26.2 Implement `src/brain/health.py` — ServiceHealthMonitor: track per-service error rates over rolling windows
- [x] 26.3 Implement LLM provider health tracking: update on every LLM call result (success/failure)
- [x] 26.4 Implement gateway health polling: periodic GET to gateway /health endpoints
- [x] 26.5 Implement health-aware model routing: if primary provider Failed/Degraded, prefer healthy alternative
- [x] 26.6 Implement health state API: GET /api/v1/health/services and GET /api/v1/health/services/{name}
- [x] 26.7 Emit plugin.health events to event bus on state transitions
- [x] 26.8 Write integration test: 5 consecutive LLM failures transition provider to Degraded, model router falls back

## 27. Testing & Cutover

- [x] 27.1 Write integration test: brain invoke endpoint with mock LLM returns valid response
- [x] 27.2 Write integration test: governance pipeline blocks forbidden action, approves T1 action
- [x] 27.3 Write integration test: model router classifies simple_reply → fast model
- [x] 27.4 Write integration test: workspace bootstrap loads files in correct order
- [x] 27.5 Write end-to-end smoke test: send message through WhatsApp gateway → brain → response
- [x] 27.6 Write end-to-end smoke test: Telegram message with approval flow
- [x] 27.7 Write integration test: full lifecycle — agent spawns, processes message, compacts thread, recovers from LLM error
- [x] 27.8 Write integration test: event bus routes failure → recovery engine → retry succeeds
- [ ] 27.9 Run OpenClaw migration import for Maya's configuration
- [ ] 27.10 Deploy NUVEX alongside OpenClaw on Hetzner VPS (different ports)
- [ ] 27.11 Run 48-hour parallel monitoring before cutting over
- [ ] 27.12 Cut port bindings from OpenClaw to NUVEX, verify all channels operational

## 28. Organisational Memory

> Spec: `specs/organisational-memory/spec.md`
>
> Replaces flat file-based MEMORY.md/daily memory with a governed, scoped, semantically-retrieved
> memory layer. Reduces hallucinations by grounding claims in retrieved facts; reduces errors through
> organisational learning (facts propagate up the delegation chain); reduces prompt tokens by injecting
> only the top-K relevant memories (~600 tokens) rather than bulk-loading daily files.

### 28.1 Database migrations
- [x] 28.1 Write migration: add `scope`, `owner_id`, `confidence`, `source_agent`, `source_thread`, `access_tier`, `promoted_from`, `approved_by`, `expires_at`, `retrieval_count` columns to `memories` table
- [x] 28.2 Write migration: create `memory_promotions` table (`id`, `source_memory_id`, `target_scope`, `requested_by`, `requested_at`, `approved_by`, `approved_at`, `status`)
- [x] 28.3 Add `memory.promotion_pending` lane to event bus lane enum and cron for daily forgetting

### 28.2 Retriever
- [x] 28.4 Implement `src/brain/memory/retriever.py` — embed incoming message, ANN search across `memories` table, filter by tier+scope, return top-K within token budget
- [x] 28.5 Implement minimum cosine threshold (default 0.72): omit entries that score below threshold
- [x] 28.6 Implement token-budget enforcement: if K results exceed `memory_token_budget` (default 600 tokens), drop lowest-ranked until within budget
- [x] 28.7 Implement graceful degradation: if budget exceeded at K=10 → reduce to K=5 → K=3 → omit block entirely before triggering compaction

### 28.3 System prompt injection
- [x] 28.8 Modify `src/brain/workspace.py`: call `MemoryRetriever` after compaction check; inject `[MEMORY]` block immediately after governance preamble
- [x] 28.9 Implement `[UNCERTAIN]` and `[M]` citation instructions in the memory injection block
- [x] 28.10 Implement `forbidden_tools: [memory_retrieve]` bypass: if present in agent config, skip retrieval entirely

### 28.4 Consolidator
- [x] 28.11 Implement `src/brain/memory/consolidator.py` — end-of-thread fact extraction using fast_model; extract up to 5 facts per thread; embed and write to `memories` table
- [x] 28.12 Implement consolidation skip: fewer than 3 messages or only greetings → no consolidation run
- [x] 28.13 Implement confidence threshold: facts with `confidence < 0.5` are discarded; facts with `confidence >= 0.85` are flagged for division-scope promotion
- [x] 28.14 Tag facts from failed threads with `{"source_outcome": "failed"}` in JSONB metadata
- [x] 28.15 Wire consolidator into brain graph: run as PostToolUse hook on thread `Finished` and `Failed` lifecycle events

### 28.5 Promoter
- [x] 28.16 Implement `src/brain/memory/promoter.py` — personal → division promotion: auto-promote on confidence >= 0.85, duplicate-check via cosine similarity > 0.95
- [x] 28.17 Implement division → org promotion: create pending entry, emit `memory.promotion_pending` event to T1 agents
- [x] 28.18 Implement `approve_org_memory(memory_id)` built-in tool: T1-only, sets `approved_by`, makes entry live
- [x] 28.19 Implement org-scope entries invisible to retrieval until `approved_by` is set

### 28.6 Forgetter
- [x] 28.20 Implement `src/brain/memory/forgetter.py` — daily cron: prune personal-scope entries when count > `max_personal_memories` (default 500), targeting oldest with `confidence < 0.6`
- [x] 28.21 Implement budget-pressure pruning: if agent at >= 95% budget for 3 consecutive days, prune personal entries > 30 days old with `confidence < 0.7`
- [x] 28.22 Implement pruning immunity: entries with `retrieval_count >= 5` are never auto-pruned

### 28.7 Governance integration
- [x] 28.23 Register `memory_retrieve` as a virtual tool in the governance pipeline: passes through `forbidden_check` and `classification_check` before injection
- [x] 28.24 Implement cross-division block: classification check filters out division-scope entries from other divisions regardless of tier

### 28.8 Dashboard
- [x] 28.25 Implement `src/dashboard/routers/memory.py` — GET/DELETE `/api/memory`, GET `/api/memory/{id}`, POST `/api/memory/{id}/promote`, GET `/api/memory/pending-approvals`, POST `/api/memory/{id}/approve`
- [x] 28.26 Build dashboard Memory page: memory counts by scope per agent, recent consolidations with thread link, pending org approvals (T1 only), avg tokens injected per invocation

### 28.9 Tests
- [x] 28.27 Write unit test: retriever returns only memories within token budget and above cosine threshold
- [x] 28.28 Write unit test: consolidator extracts facts from a 10-message thread; confidence < 0.5 entries discarded
- [x] 28.29 Write unit test: personal fact with confidence >= 0.85 is promoted to division scope with correct `promoted_from` FK
- [x] 28.30 Write unit test: org-scope pending entry not returned by retrieval until `approved_by` set
- [x] 28.31 Write unit test: `forbidden_tools: [memory_retrieve]` skips memory injection entirely
- [x] 28.32 Write unit test: forgetter prunes correct entries; entries with `retrieval_count >= 5` preserved
- [x] 28.33 Write integration test: end-to-end — invoke agent, fact consolidated, injected on next invocation, `[M]` citation present in response

### 28.10 Topic segmentation
- [x] 28.34 Write migration: add `embedding vector(1536)`, `segment_id UUID`, `segment_boundary BOOLEAN`, `segment_summary TEXT` columns to `messages` table
- [x] 28.35 Write migration: create `message_segments` table (`id`, `thread_id`, `agent_id`, `start_message_id`, `end_message_id`, `state`, `summary`, `created_at`, `closed_at`)
- [x] 28.36 Implement `src/brain/memory/segmenter.py` — embed each message on receipt, compute cosine similarity to previous message, detect boundary on drop below `segment_boundary_threshold` (default 0.58) or time gap > `segment_time_gap_minutes` (default 60)
- [x] 28.37 Implement segment lifecycle transitions: open → closing (boundary detected) → closed (consolidation done); persist state in `message_segments` table
- [x] 28.38 Implement segment-based prompt assembly in `src/brain/workspace.py`: prior closed segments appear as 1-line summaries (capped at `max_prior_summaries`, default 5); active segment messages loaded verbatim
- [x] 28.39 Implement group-chat agent-relevance scoring: score each active-segment message (+1.0 @-mention, +0.6 topic match, +0.2 baseline); compress messages below `group_relevance_threshold` (default 0.25) to single-line form
- [x] 28.40 Implement segment-close consolidation trigger: on segment close, fire async consolidation on that segment's messages within 30 seconds
- [x] 28.41 Implement minimum message guard: skip segmentation for threads with fewer than `segment_min_messages` (default 10) messages
- [x] 28.42 Update `MemoryRetriever` to use centroid of last 3 active-segment message embeddings as ANN query vector instead of current message only
- [x] 28.43 Write unit test: cosine drop below threshold between messages N and N+1 sets `segment_boundary=true` on message N+1
- [x] 28.44 Write unit test: closed segment produces 1-line summary in prompt; verbatim messages excluded
- [x] 28.45 Write unit test: group chat with 40 messages, 28 low-relevance → 28 compressed to single-line form
- [x] 28.46 Write integration test: topic boundary detected → segment closes → consolidation fires → facts in memory store for next invocation

## 29. Tool Surface Governance

> Spec: `specs/tool-surface-governance/spec.md`
>
> Per-agent tool manifests with token budgets, usage analytics, dead-tool detection, and
> error-rate alerting. Prevents prompt bloat from unused tool definitions and catches
> misrouted/broken tools. Learned from OB1's tool-audit methodology.

### 29.1 Database migration
- [ ] 29.1 Write migration: create `tool_usage_stats` table (id, agent_id, tool_name, call_count, error_count, last_used, window_start; unique on agent_id+tool_name+window_start)

### 29.2 Tool manifest
- [ ] 29.2 Implement `src/brain/tools/manifest.py` — `ToolManifestEntry` dataclass, `build_manifest()` that collects all tools from built-in, skills, MCP, plugins with per-tool token cost estimation
- [ ] 29.3 Implement `prune_to_budget()` — given a manifest and `tool_token_budget`, prune least-used-in-24h tools first; never prune tools used in the most recent invocation

### 29.3 Usage tracking
- [ ] 29.4 Implement `tool_usage_hook()` PostToolUse hook in `src/brain/hooks/__init__.py` — upsert `tool_usage_stats` row after every tool call (call_count += 1, error_count += 1 on failure, update last_used)
- [ ] 29.5 Wire `tool_usage_hook()` into `register_default_hooks()` — no change to existing hooks

### 29.4 Token budget enforcement
- [ ] 29.6 Add optional `tool_token_budget: int` (default 4000) and `tool_auto_prune: bool` (default false) to agent config in `src/shared/config.py`
- [ ] 29.7 Integrate `prune_to_budget()` into `src/brain/workspace/__init__.py` tool definition assembly — call before serialising tool defs into the system prompt. When budget is null/omitted, skip pruning (backward compatible).

### 29.5 Dead tool detection
- [ ] 29.8 Implement `detect_dead_tools()` in `src/brain/tools/manifest.py` — identify tools with 0 calls in the last 7 days per agent
- [ ] 29.9 Register `dead_tool_scan` daily cron in `src/brain/cron.py` — calls `detect_dead_tools()`, emits `tool.dead_detected` events
- [ ] 29.10 Implement auto-hide: when `tool_auto_prune: true` and a tool has been dead 14+ days, exclude from prompt until manually re-enabled

### 29.6 Error rate alerting
- [ ] 29.11 Implement error rate check: when a tool's error rate > 50% with ≥ 5 calls in the last 24h, emit `tool.high_error_rate` event and mark manifest entry as `status: "degraded"`

### 29.7 API & dashboard
- [ ] 29.12 Implement `GET /api/v1/agents/{id}/tools` — return tool manifest with usage stats
- [ ] 29.13 Build dashboard tool manifest panel on agent detail page

### 29.8 Tests
- [ ] 29.14 Write unit test: `build_manifest()` collects tools from all sources with correct token estimates
- [ ] 29.15 Write unit test: `prune_to_budget()` removes least-used tools first, preserves recent-invocation tools
- [ ] 29.16 Write unit test: `detect_dead_tools()` flags tools with 0 calls over 7 days
- [ ] 29.17 Write unit test: `tool_usage_hook()` upserts stats correctly on success and failure
- [ ] 29.18 Write integration test: agent with 40 tools and 4000-token budget → prompt contains only high-usage tools within budget

## 30. Schema-Aware Capture Router

> Spec: `specs/capture-router/spec.md`
>
> Multi-fragment extraction from a single inbound message, dispatched to typed handlers
> (contacts, tasks, facts, preferences). Opt-in per agent. Learned from OB1's
> schema-aware-routing recipe.

### 30.1 Capture registry
- [ ] 30.1 Implement `src/brain/capture/registry.py` — `CaptureSchema` model, `CaptureRegistry` with `register()` and `get_schemas()`. Built-in schemas: contact, task, preference, fact.
- [ ] 30.2 Implement JSON Schema definitions for each built-in capture schema (contact requires name; task requires title; fact requires text; preference requires key+value)

### 30.2 Extractor
- [ ] 30.3 Implement `src/brain/capture/extractor.py` — `extract_fragments()` using fast model with structured output. Returns array of `{schema, data}` fragments. Skips messages shorter than `min_message_length`.

### 30.3 Router & dispatch
- [ ] 30.4 Implement `src/brain/capture/router.py` — `dispatch_fragments()` validates each fragment against its schema, calls the corresponding write handler. Invalid fragments logged and discarded.
- [ ] 30.5 Implement dedup check before dispatch: fingerprint each fragment, skip if matching fingerprint written in last 5 minutes (integrates with Section 32 if available, else standalone hash check)

### 30.4 Write handlers
- [ ] 30.6 Implement `src/brain/capture/handlers/contact.py` — writes/updates `workspace/contacts/people/<name>.md` per Section 16 format. Merges fields if file exists.
- [ ] 30.7 Implement `src/brain/capture/handlers/task.py` — calls `create_task()` from Section 23. Checks for duplicate title in pending tasks before creation.
- [ ] 30.8 Implement `src/brain/capture/handlers/fact.py` — writes personal-scope memory entry via Section 28 consolidator. Cosine dedup against existing memories.
- [ ] 30.9 Implement `src/brain/capture/handlers/preference.py` — updates agent preference config file in workspace.

### 30.5 Integration
- [ ] 30.10 Add optional `capture_router` config block to agent model in `src/shared/config.py` (enabled: bool, schemas: list, min_message_length: int). Default: enabled=false.
- [ ] 30.11 Register `capture_router_hook` as PreToolUse hook in `src/brain/hooks/__init__.py` — only active when `capture_router.enabled = true`. Appends `[CAPTURED]` summary to system prompt.
- [ ] 30.12 Add optional `capture_schemas` field to SKILL.md frontmatter spec for skill-provided schemas

### 30.6 Tests
- [ ] 30.13 Write unit test: compound message extracts contact + task fragments
- [ ] 30.14 Write unit test: short message skipped — no extraction call
- [ ] 30.15 Write unit test: invalid fragment discarded, valid sibling dispatched
- [ ] 30.16 Write unit test: duplicate contact merged, not overwritten
- [ ] 30.17 Write integration test: user message "Met Sarah from Acme, remind me Thursday" → contact file created + task in queue

## 31. Adaptive Classification

> Spec: `specs/adaptive-classification/spec.md`
>
> Self-calibrating model router: tracks routing outcome quality, adjusts classifier thresholds
> based on accuracy data, A/B-style feedback loop. Learned from OB1's adaptive-capture-classification.

### 31.1 Database migration
- [ ] 31.1 Write migration: create `routing_outcomes` table (id, agent_id, classification, model_tier, model_used, outcome_score, retry_occurred, token_count, cost_usd, created_at; index on agent_id+classification+created_at)

### 31.2 Outcome scoring
- [ ] 31.2 Implement `record_routing_outcome()` in `src/brain/routing/router.py` — records outcome score based on retry, clarification, acceptance, task completion signals
- [ ] 31.3 Wire outcome recording into `src/brain/graph.py` — call `record_routing_outcome()` after each LLM response evaluation. Purely additive, no restructuring.

### 31.3 Accuracy tracking
- [ ] 31.4 Implement `src/brain/routing/accuracy.py` — `compute_accuracy()` returns rolling 7-day average outcome score per (agent, classification, model_tier). `suggest_threshold_adjustment()` returns new thresholds when accuracy < floor.

### 31.4 Classifier refactor (backward-compatible)
- [ ] 31.5 Refactor `src/brain/routing/classifier.py` — extract hardcoded thresholds into `ClassifierConfig` dataclass with defaults matching current values. `classify()` gains optional `config: ClassifierConfig` param. **When omitted, behaviour is identical to today. Run existing classifier tests to confirm.**
- [ ] 31.6 Add optional `adaptive: bool` (default false), `accuracy_floor: float` (default 0.65), `adjustment_interval_days: int` (default 3) to routing config in `src/shared/config.py`

### 31.5 Adaptive threshold adjustment
- [ ] 31.7 When `adaptive: true`, load adaptive thresholds from DB before `classify()` in `src/brain/graph.py`. When false, use static defaults.
- [ ] 31.8 Register daily `routing_threshold_calibration` cron in `src/brain/cron.py` — only runs when any agent has `adaptive: true`. Calls `suggest_threshold_adjustment()` and persists new thresholds.

### 31.6 API & dashboard
- [ ] 31.9 Implement `GET /api/v1/routing/analytics` — per-classification accuracy, misroute rates, threshold values
- [ ] 31.10 Build dashboard routing analytics page with accuracy charts and threshold visualisation

### 31.7 Tests
- [ ] 31.11 Write unit test: `ClassifierConfig` with default values produces identical results to current `classify()`
- [ ] 31.12 Write unit test: `record_routing_outcome()` writes correct score for success/retry/failure cases
- [ ] 31.13 Write unit test: `compute_accuracy()` returns correct 7-day rolling average
- [ ] 31.14 Write unit test: `suggest_threshold_adjustment()` tightens threshold when accuracy < floor
- [ ] 31.15 Write integration test: 3 days of low accuracy → adaptive mode adjusts threshold → more messages routed to primary

## 32. Content Fingerprint Deduplication

> Spec: `specs/content-fingerprint/spec.md`
>
> Cheap deterministic dedup layer via normalised-text SHA-256 fingerprints. Covers memory
> consolidation, event bus, and capture router. Learned from OB1's content fingerprinting.

### 32.1 Fingerprint utility
- [ ] 32.1 Implement `src/brain/utils/fingerprint.py` — `content_fingerprint(text: str) -> str`: normalise whitespace, lowercase, SHA-256, return first 16 hex chars. Pure function, no side effects.

### 32.2 Memory dedup
- [ ] 32.2 Write migration: add `content_hash TEXT` column to `memories` table with unique index on `(scope, owner_id, content_hash)`
- [ ] 32.3 Extend `src/brain/memory/consolidator.py` — after `_fast_extract()`, compute fingerprint per fact, check for existing `content_hash` in same scope+owner before writing. Skip duplicate (no embedding call). **Existing cosine dedup in promoter.py remains unchanged — fingerprint catches cheap exact dupes first.**

### 32.3 Event dedup
- [ ] 32.4 Extend `src/brain/events.py` — in `publish()`, compute fingerprint from `(lane, agent_id, json.dumps(payload, sort_keys=True))`, check for matching fingerprint in last 60 seconds before insert. Silently skip duplicates with debug log.

### 32.4 Capture router dedup (depends on Section 30)
- [ ] 32.5 If Section 30 is implemented: extend `src/brain/capture/router.py` to fingerprint each fragment before dispatch, skip if matching fingerprint within last 5 minutes.

### 32.5 Tests
- [ ] 32.6 Write unit test: identical texts with different whitespace produce same fingerprint
- [ ] 32.7 Write unit test: different texts produce different fingerprints
- [ ] 32.8 Write unit test: consolidator skips fact when content_hash already exists in scope+owner
- [ ] 32.9 Write unit test: event bus skips duplicate event within 60s, allows after 61s
- [ ] 32.10 Write integration test: same thread consolidated twice → no duplicate memories created

## 33. Skill & Plugin Validation Gate

> Spec: `specs/contribution-ci-gate/spec.md`
>
> Schema validation for SKILL.md frontmatter, tool reference checking, plugin metadata
> validation. Invalid skills are skipped with diagnostics instead of silently breaking.
> Learned from OB1's metadata.json CI gate.

### 33.1 Skill validator
- [ ] 33.1 Implement `src/brain/skills/validator.py` — `validate_skill(skill_dir: Path) -> ValidationResult`. Checks required frontmatter fields (name, description), validates tool references point to existing scripts, estimates token cost.
- [ ] 33.2 Define `ValidationResult` with `valid: bool`, `errors: list[str]`, `warnings: list[str]`, `token_estimate: int`

### 33.2 Validation on load
- [ ] 33.3 Extend `src/brain/workspace/__init__.py` — in `load_skill_files()` / `load_skill_metas()`, call `validate_skill()` before including skill. Invalid skills are skipped. **Wrapped in try/except so validator crash still loads the skill (fail-open). Existing valid skills load identically.**
- [ ] 33.4 Emit `skill.validation_failed` event to event bus when a skill fails validation

### 33.3 Plugin metadata
- [ ] 33.5 Implement `src/brain/plugins/metadata.py` — `validate_plugin_metadata(package_path: Path) -> ValidationResult`. Checks optional `nuvex-plugin.json` for name, version, min_nuvex_version, provides, tier_required.
- [ ] 33.6 Plugins without `nuvex-plugin.json` still load (backward compatible) with a warning. Plugins with version mismatch are blocked with error event.

### 33.4 API & dashboard
- [ ] 33.7 Implement `GET /api/v1/agents/{id}/skills` — return loaded skills with validation status, token estimates
- [ ] 33.8 Build dashboard skills panel on agent detail page

### 33.5 Tests
- [ ] 33.9 Write unit test: valid SKILL.md with all fields passes validation
- [ ] 33.10 Write unit test: missing `name` field fails validation
- [ ] 33.11 Write unit test: tool reference to nonexistent script produces warning (not error)
- [ ] 33.12 Write unit test: invalid skill skipped during workspace assembly, valid siblings still loaded
- [ ] 33.13 Write unit test: plugin with version mismatch blocked; plugin without metadata loads with warning

## 34. Local Embedding Fallback

> Spec: `specs/local-embeddings/spec.md`
>
> Provider-abstracted embedding with Ollama fallback. Eliminates single-point-of-failure on
> external embedding APIs. Learned from OB1's local-ollama-embeddings recipe.

### 34.1 Embedder abstraction
- [ ] 34.1 Implement `src/brain/memory/embedder.py` — `Embedder` protocol with `embed()` and `embed_single()`. Implementations: `OpenAIEmbedder` (extracts current inline logic from retriever/consolidator/segmenter), `OllamaEmbedder` (calls `/api/embeddings`).
- [ ] 34.2 Implement `get_embedder()` factory — reads `embedding` config block, returns primary embedder with optional fallback wrapper. Defaults to OpenAI when no config block present.

### 34.2 Migrate existing embedding calls (backward-compatible refactor)
- [ ] 34.3 Refactor `src/brain/memory/retriever.py` — replace inline `_embed()` with `get_embedder().embed_single()`. **Existing behaviour identical. Mock target changes from `retriever._embed` to `embedder.get_embedder` in tests.**
- [ ] 34.4 Refactor `src/brain/memory/consolidator.py` — same pattern: replace `_embed()` with `get_embedder().embed_single()`.
- [ ] 34.5 Refactor `src/brain/memory/segmenter.py` — same pattern: replace inline embedding with `get_embedder()`.

### 34.3 Configuration
- [ ] 34.6 Add optional `embedding` config block to `src/shared/config.py` — provider, model, fallback (provider, model, base_url), dimension. Defaults: provider="openai", model="text-embedding-3-small", dimension=1536, no fallback.
- [ ] 34.7 Implement dimension validation at startup — if configured dimension doesn't match pgvector column, log CRITICAL and disable memory system.

### 34.4 Fallback & health integration
- [ ] 34.8 Implement fallback logic in embedder: when primary raises exception or times out (5s), try fallback. Emit `embedding.fallback_activated` event. If fallback dimension doesn't match primary, disable fallback at startup with warning.
- [ ] 34.9 Extend `src/brain/health.py` — register embedding provider as `embedding/<provider>` in ServiceHealthMonitor. Embedding errors feed into health state transitions.

### 34.5 Docker integration
- [ ] 34.10 Add optional Ollama service to `docker-compose.local.yml` under `local-embeddings` profile. Volume for model storage. Bound to `127.0.0.1:11434`.

### 34.6 Tests
- [ ] 34.11 Write unit test: `OpenAIEmbedder` produces same results as the previous inline `_embed()` function
- [ ] 34.12 Write unit test: `OllamaEmbedder` calls correct endpoint with correct payload
- [ ] 34.13 Write unit test: fallback activates when primary raises; fallback disabled on dimension mismatch
- [ ] 34.14 Write unit test: `get_embedder()` with no config returns OpenAI embedder (backward compatible)
- [ ] 34.15 Write unit test: retriever/consolidator/segmenter work identically after refactor (mock at new location)
- [ ] 34.16 Write integration test: primary provider fails → fallback used → memory retrieval succeeds
