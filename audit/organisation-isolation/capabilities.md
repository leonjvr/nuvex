# Capability Audit

## org-model

Status: `no evidence`

Spec intent: add an `Organisation` model, Pydantic schemas, org lifecycle rules, agent-to-org binding, CRUD endpoints, and default-org migration behavior.

Evidence:

- `src/brain/models/agent.py` has no `org_id` field.
- `src/brain/models_registry.py` contains only model instantiation logic and no organisation registration.
- No `src/brain/models/organisation.py` file exists.
- No `src/shared/models/organisation.py` file exists.

Gaps:

- No organisation SQLAlchemy model.
- No organisation Pydantic schemas.
- No lifecycle transition enforcement for org status.
- No org CRUD router.

Tests:

- No org-model tests found.

## org-config-loader

Status: `partial evidence`

Spec intent: load `/data/orgs/*/config.yaml`, sync YAML to DB, support `governance.yaml`, provide legacy fallback, and add reload/divergence handling.

Evidence:

- `src/shared/config.py` loads a single flat config file from `NUVEX_CONFIG` and parses one `agents` list.

Gaps:

- No per-org directory scan.
- No YAML-to-DB sync.
- No `nuvex config reload` command.
- No divergence warning logic.
- No org-level governance YAML loader.

Tests:

- No config-loader tests for org YAML, fallback, or divergence.

## org-scoped-data

Status: `no evidence`

Spec intent: add `org_id` to agent-scoped data and centralize query filtering through `org_scope()`.

Evidence:

- `src/brain/models/agent.py`, `src/brain/models/thread.py`, and `src/brain/models/events.py` contain no `org_id` columns.
- No `src/brain/org_scope.py` file exists.
- `src/brain/routers/threads.py` queries `Thread` globally and can fetch any thread by raw ID.

Gaps:

- No `org_scope()` helper.
- No org validation on thread lookup.
- No cross-org access prevention at query level.

Tests:

- No unit or integration tests for org scoping or isolation.

## postgresql-storage

Status: `partial evidence`

Spec intent: evolve PostgreSQL schema to support organisations, `org_id` columns, composite indexes, `work_packets`, and `channel_bindings`.

Evidence:

- `src/brain/migrations/versions/0001_initial_schema.py` defines flat tables: `agents`, `threads`, `messages`, `governance_audit`, `budgets`, `events`, `tasks`, and `cron_entries`.
- `src/brain/migrations/versions/0004_add_agent_lifecycle.py` exists, showing migrations are in use, but there is no org-scoping migration afterward.

Gaps:

- No `organisations` table.
- No `org_id` on existing agent-scoped tables.
- No composite `(org_id, agent_id)` indexes.
- No `work_packets` or `channel_bindings` table.
- No backfill or rollback migration for org isolation.

Tests:

- No migration tests for default-org backfill or rollback.

## langgraph-brain

Status: `partial evidence`

Spec intent: thread `org_id` through state, routing, thread IDs, and middleware.

Evidence:

- `src/brain/state.py` defines `AgentState` without `org_id`.
- `src/brain/routers/invoke.py` exposes `/invoke` and `/invoke/stream` only.
- `src/brain/server.py` mounts flat routers and no org validation middleware.

Gaps:

- No `org_id` in `AgentState`.
- No `/api/v1/orgs/{org_id}/invoke` route.
- No `parse_thread_id()` utility.
- No org middleware for active or suspended org checks.
- No graph-node propagation of `org_id`.

Tests:

- No tests for org-prefixed thread IDs or org-scoped invoke routing.

## gateway-architecture

Status: `partial evidence`

Spec intent: make gateways org-aware via `NUVEX_ORG_ID`, org-scoped thread IDs, and backward-compatible defaults.

Evidence:

- `src/shared/models/requests.py` defines a shared `InvokeRequest`, but it has no `org_id` field.
- `docker-compose.local.yml` defines the brain service only and contains no gateway `NUVEX_ORG_ID` environment settings.

Gaps:

- No org field in the shared invoke contract.
- No demonstrated gateway handling of `NUVEX_ORG_ID`.
- No backward-compatible default-org warning path.

Tests:

- No gateway contract tests for org-aware invocation.

## policy-engine

Status: `partial evidence`

Spec intent: merge global, org, and agent policies with strictest-wins semantics.

Evidence:

- `src/brain/governance/policy_engine.py` implements a working rule engine.
- `PolicyContext` includes `agent_id`, `action_type`, `payload`, and `metadata`, but no `org_id`.

Gaps:

- No `merge_policies()` function.
- No org-level budget enforcement.
- No org policy loading in `evaluate()`.
- No org policy endpoints.

Tests:

- No merge-policy tests.

## governance-pipeline

Status: `partial evidence`

Spec intent: make governance checks and audit org-aware.

Evidence:

- Governance infrastructure exists under `src/brain/governance/`.
- `src/brain/migrations/versions/0001_initial_schema.py` creates `governance_audit`, but only with `agent_id`, `invocation_id`, and `thread_id`.

Gaps:

- No `org_id` on governance audit entries.
- No org-aware hook context.
- No org-scoped audit query behavior.
- No explicit cross-org blocking at governance query boundaries.

Tests:

- No audit-chain or governance tests with org context.

## workspace-bootstrap

Status: `partial evidence`

Spec intent: move workspaces to `/data/orgs/{org_id}/agents/{agent_id}/workspace/` and support org templates.

Evidence:

- `src/brain/workspace.py` provides `load_workspace_files(workspace_path: str)` and prompt assembly from a single workspace path.
- `src/brain/routers/invoke.py` fetches `workspace_path` directly from the agent row.

Gaps:

- No `(org_id, agent_id)` path resolution.
- No default-org legacy fallback.
- No org template lookup.
- No bootstrap logic for org-scoped directories.

Tests:

- No tests for org workspace resolution or template precedence.

## task-packets

Status: `partial evidence`

Spec intent: keep task delegation intra-org and direct cross-org delegation to work packets.

Evidence:

- `src/brain/migrations/versions/0001_initial_schema.py` creates a `tasks` table.

Gaps:

- No `org_id` on task records.
- No same-org validation for delegation.
- No handoff error path telling callers to use `send_work_packet`.

Tests:

- No task-packet org-boundary tests.

## agent-lifecycle

Status: `partial evidence`

Spec intent: include org context in lifecycle records and queries.

Evidence:

- `src/brain/models/lifecycle.py` defines `AgentLifecycleEvent` with `agent_id`, `from_state`, `to_state`, and `invocation_id`.
- `src/dashboard/routers/agents.py` exposes lifecycle events by `agent_id` only.

Gaps:

- No `org_id` on lifecycle records.
- No org-scoped lifecycle queries.

Tests:

- No lifecycle tests for org-boundary behavior.

## event-bus

Status: `partial evidence`

Spec intent: add org context to events and work-packet lifecycle events.

Evidence:

- `src/brain/models/events.py` defines persistent events with `lane`, `status`, `agent_id`, and `payload`.
- `src/dashboard/routers/events.py` lists events with global filters for lane, status, and `agent_id` only.

Gaps:

- No `org_id` on events.
- No org filtering.
- No work-packet lifecycle event types.

Tests:

- No event-bus tests for org filtering.

## cron-registry

Status: `partial evidence`

Spec intent: make cron entries and APIs org-scoped.

Evidence:

- `src/brain/routers/cron.py` lists and mutates cron jobs globally.
- `src/brain/migrations/versions/0001_initial_schema.py` creates `cron_entries` with `agent_id` but no `org_id`.

Gaps:

- No `org_id` on cron entries.
- No org-scoped cron routes.
- No org-aware HEARTBEAT parsing path.

Tests:

- No cron tests for org-scoped behavior.

## channel-ownership

Status: `no evidence`

Spec intent: bind each channel identity to exactly one org and expose channel-management APIs.

Evidence:

- No `channel_binding` model file exists.
- No `channels` router exists under `src/brain/routers/`.

Gaps:

- No `channel_bindings` table.
- No uniqueness enforcement.
- No invoke-path ownership validation.
- No auto-binding from gateway configuration.

Tests:

- No channel-binding tests.

## inter-org-packets

Status: `no evidence`

Spec intent: implement explicit cross-org communication through work packets.

Evidence:

- No `work_packet` model file exists.
- No `work_packets` router exists.
- No `send_work_packet` tool implementation was found.

Gaps:

- No packet persistence layer.
- No communication-links validation.
- No sync or async dispatch flow.
- No packet handler routing.
- No packet audit trail.

Tests:

- No work-packet integration tests.

## plugin-config

Status: `no evidence`

Spec intent: make plugin enablement org-aware and org-scoped.

Evidence:

- No org-aware plugin loader or plugin-config API implementation was found in `src/brain/`.

Gaps:

- No org `enabled_plugins` enforcement.
- No org-scoped plugin config API route.

Tests:

- No plugin-config org tests.

## plugin-sdk

Status: `no evidence`

Spec intent: add `org_id` to plugin execution context.

Evidence:

- No Python plugin SDK files relevant to this change were found under `src/`.

Gaps:

- No `ExecutionContext.org_id`.
- No plugin API org propagation.

Tests:

- No plugin-SDK org tests.

## contact-management

Status: `no evidence`

Spec intent: scope contacts to org workspaces and prevent path escape.

Evidence:

- No org-aware contact-management implementation was found.

Gaps:

- No org-scoped contacts path.
- No path-boundary validation for org workspaces.
- No org-scoped contact refresh query path.

Tests:

- No contact-management org tests.

## nuvex-dashboard

Status: `partial evidence`

Spec intent: add org overview, selector, org-scoped filtering, channel bindings, and work packet views.

Evidence:

- `src/dashboard/frontend/src/App.tsx` defines a flat sidebar with pages for agents, audit, threads, costs, tasks, events, cron, services, workspace, and lifecycle.
- `src/dashboard/frontend/src/pages/AgentsPage.tsx` fetches `/api/agents` with no org context.
- `src/dashboard/routers/agents.py` lists all agents globally.

Gaps:

- No org selector.
- No organisations list or CRUD pages.
- No org-scoped filtering for agents, threads, audit, or costs.
- No channel-binding or work-packet dashboard pages.

Tests:

- No dashboard tests for org switching or org-scoped filtering.

## Cross-Capability Conclusion

The codebase already contains the major single-org subsystems that the change intends to amend: storage, invoke routing, governance, cron, dashboard, and lifecycle. The audit issue is not subsystem absence; it is that the org-isolation amendment is still missing across all of them. The implementation should be treated as a foundational cross-cutting change, not as a small incremental patch.