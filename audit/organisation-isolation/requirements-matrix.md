# Requirement Matrix

This matrix enumerates every `Requirement` and `Scenario` under `openspec/changes/organisation-isolation/specs/` and marks each one as `implemented`, `partial`, or `missing` against the current repository state.

Interpretation rules:

- `implemented`: the org-isolation requirement is materially present in code
- `partial`: an adjacent subsystem exists, but the org-isolation amendment is incomplete
- `missing`: the requirement is not implemented in the current codebase

## org-model

Evidence baseline: `src/brain/models/agent.py`, `src/brain/routers/agents.py`, `src/brain/migrations/versions/0001_initial_schema.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Organisation table | missing | No `organisations` table, model, or registration exists. |
| Scenario: Create organisation | missing | No organisation persistence or create path exists. |
| Scenario: Reject duplicate org_id | missing | No org table or uniqueness enforcement exists. |
| Requirement: Organisation status lifecycle | missing | No org status model or transition rules exist. |
| Scenario: Suspend active organisation | missing | No suspend behavior is implemented. |
| Scenario: Invoke agent in suspended org | missing | Invoke flow has no org or org-status checks. |
| Scenario: Archive suspended organisation | missing | No archive or read-only org lifecycle exists. |
| Requirement: Organisation Pydantic model | missing | No `src/shared/models/organisation.py` equivalent exists. |
| Scenario: Validate org_id format | missing | No org create/update schema exists. |
| Scenario: Valid org_id accepted | missing | Same reason as above. |
| Requirement: Agent-to-org binding | missing | `Agent` has no `org_id` field or FK. |
| Scenario: Create agent in org | missing | Agents are globally keyed, not org-bound. |
| Scenario: Reject agent in nonexistent org | missing | No org FK or validation exists. |
| Scenario: Duplicate agent name across orgs | missing | No `(org_id, agent_id)` uniqueness path exists. |
| Requirement: Organisation CRUD API | missing | No org router exists under `src/brain/routers/`. |
| Scenario: List organisations | missing | No list endpoint exists. |
| Scenario: Update org policies | missing | No org update or policy endpoint exists. |
| Scenario: Delete (archive) organisation | missing | No archive/delete endpoint exists. |
| Requirement: Default organisation migration | missing | No default-org bootstrap or migration logic exists. |
| Scenario: First boot with existing agents | missing | Existing boot path does not create a `default` org. |
| Scenario: First boot with no agents | missing | No org auto-create path exists. |

## org-config-loader

Evidence baseline: `src/shared/config.py`, `src/brain/server.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Per-org YAML seed files | missing | Config loader reads one flat YAML file, not `/data/orgs/*/config.yaml`. |
| Scenario: Read org config from YAML | missing | No per-org scan exists. |
| Scenario: Missing org config file | missing | No per-org fallback or warning path exists. |
| Requirement: YAML-to-DB sync on boot | missing | Boot sequence does not upsert orgs or agents from YAML. |
| Scenario: New org YAML added | missing | No sync exists. |
| Scenario: Existing org YAML unchanged | missing | No sync exists. |
| Scenario: YAML differs from DB | missing | No diff or warning logic exists. |
| Requirement: Backward-compatible divisions.yaml fallback | partial | Legacy flat config exists, but it is not mapped into a `default` org model. |
| Scenario: Legacy config without orgs directory | partial | Single-file config loads, but no org abstraction is created. |
| Requirement: Config reload CLI command | missing | No `nuvex config reload` command is present. |
| Scenario: Reload after YAML edit | missing | No reload path exists. |
| Requirement: Runtime config API | missing | No org runtime config API exists. |
| Scenario: API update does not modify YAML | missing | No such API exists. |
| Scenario: Divergence warning on restart | missing | No divergence detection exists. |
| Requirement: Per-org governance YAML | missing | No `/data/orgs/{org_id}/governance.yaml` loading exists. |
| Scenario: Org governance file loaded | missing | Same as above. |
| Scenario: No governance file | missing | Same as above. |

## org-scoped-data

Evidence baseline: `src/brain/models/agent.py`, `src/brain/models/thread.py`, `src/brain/models/events.py`, `src/brain/routers/threads.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: org_id on all agent-scoped tables | missing | Core tables and models have no `org_id`. |
| Scenario: Query threads for org | missing | Threads can only be queried globally or by `agent_id`. |
| Scenario: Attempt cross-org thread access | missing | No org boundary check exists for thread access. |
| Requirement: Centralized org_scope helper | missing | No `org_scope()` helper exists. |
| Scenario: Helper applied to thread query | missing | Thread queries do not apply org scope. |
| Scenario: Missing org_scope usage detected in tests | missing | No tests enforce org scoping. |
| Requirement: Migration from flat to org-scoped schema | missing | No migration adds `org_id` or backfills rows. |
| Scenario: Migration on existing database | missing | No migration exists. |
| Scenario: Migration on empty database | missing | No migration exists. |
| Scenario: Rollback migration | missing | No rollback path exists. |
| Requirement: Composite indexes for org-scoped queries | missing | Existing indexes are not org-prefixed. |
| Scenario: Thread lookup by org | missing | No `(org_id, ...)` index exists. |
| Requirement: Cross-org data access prevention | missing | Query layer does not prevent cross-org reads. |
| Scenario: Agent in org A queries thread in org B | missing | Current routes can fetch by raw thread ID without org validation. |

## inter-org-packets

Evidence baseline: no `work_packet` model/router/tool found in `src/brain/`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Work packet data model | missing | No `work_packets` table or model exists. |
| Scenario: Create sync work packet | missing | No packet create flow exists. |
| Scenario: Create async work packet | missing | No packet create flow exists. |
| Requirement: Communication links validation | missing | No org communication-links model or validation exists. |
| Scenario: Allowed packet type | missing | No validation logic exists. |
| Scenario: Undeclared packet type | missing | No validation logic exists. |
| Scenario: Undeclared target org | missing | No validation logic exists. |
| Requirement: Sync dispatch flow | missing | No dispatch infrastructure exists. |
| Scenario: Successful sync dispatch | missing | No dispatch infrastructure exists. |
| Scenario: Sync dispatch timeout | missing | No dispatch infrastructure exists. |
| Requirement: Async dispatch flow | missing | No async packet handling exists. |
| Scenario: Async packet submitted | missing | No async packet handling exists. |
| Scenario: Async packet completed | missing | No async packet handling exists. |
| Scenario: Async result retrieval | missing | No async packet handling exists. |
| Requirement: send_work_packet tool | missing | No built-in tool exists. |
| Scenario: Agent uses send_work_packet tool | missing | No built-in tool exists. |
| Scenario: Tool forbidden by policy | missing | No tool exists to govern. |
| Requirement: Packet handler agent designation | missing | No org handler config exists. |
| Scenario: Handler agent configured | missing | No org handler config exists. |
| Scenario: No handler configured | missing | No org handler config exists. |
| Requirement: Budget attribution | missing | No org budget attribution exists for packets. |
| Scenario: Budget consumed by target org | missing | No packet system exists. |
| Requirement: Payload size limit | missing | No per-org packet size validation exists. |
| Scenario: Payload within limit | missing | No validation path exists. |
| Scenario: Payload exceeds limit | missing | No validation path exists. |
| Requirement: Work packet audit trail | missing | No packet lifecycle auditing exists. |
| Scenario: Packet lifecycle audited | missing | No packet lifecycle auditing exists. |

## channel-ownership

Evidence baseline: `src/brain/routers/invoke.py`, no `channel_binding` model or router found

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Channel-to-org binding table | missing | No `channel_bindings` table or model exists. |
| Scenario: Bind WhatsApp number to org | missing | No binding persistence exists. |
| Scenario: Reject duplicate channel binding | missing | No uniqueness enforcement exists. |
| Requirement: Gateway org validation | missing | Invoke path does not validate channel ownership against org. |
| Scenario: Valid channel ownership | missing | No binding validation exists. |
| Scenario: Channel not bound to declared org | missing | No binding validation exists. |
| Requirement: Channel binding management API | missing | No `/channels` router exists. |
| Scenario: List channel bindings for org | missing | No binding API exists. |
| Requirement: Front-desk delegation pattern | missing | No work-packet delegation machinery exists. |
| Scenario: Front-desk receives and delegates | missing | No work-packet delegation machinery exists. |
| Scenario: Front-desk receives delegated result | missing | No work-packet delegation machinery exists. |
| Requirement: Auto-binding from gateway config | missing | No gateway registration or auto-binding logic exists. |
| Scenario: Gateway auto-registers binding | missing | No gateway registration or auto-binding logic exists. |

## postgresql-storage

Evidence baseline: `src/brain/migrations/versions/0001_initial_schema.py`, `src/brain/migrations/versions/0004_add_agent_lifecycle.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: PostgreSQL as primary database | partial | PostgreSQL storage exists, but the org-isolation schema amendment is absent. |
| Scenario: Schema includes org_id on agent-scoped tables | missing | No `org_id` columns are present. |
| Scenario: Organisation table exists | missing | No `organisations` table exists. |
| Requirement: Schema migration system | partial | Alembic exists, but no org-isolation migration has been added. |
| Scenario: Migration adds org_id to existing tables | missing | No such migration exists. |
| Requirement: Concurrent multi-agent writes | partial | Baseline concurrent storage exists, but not with org-isolated semantics. |
| Scenario: Two agents in different orgs write concurrently | partial | Writes are supported, but org boundaries are not modeled. |
| Requirement: Composite indexes including org_id | missing | No org-prefixed indexes exist. |
| Scenario: Thread query uses org-prefixed index | missing | No org-prefixed indexes exist. |
| Requirement: Work packets table | missing | No `work_packets` table exists. |
| Scenario: Work packets table exists | missing | No `work_packets` table exists. |
| Requirement: Channel bindings table | missing | No `channel_bindings` table exists. |
| Scenario: Channel bindings table exists | missing | No `channel_bindings` table exists. |

## langgraph-brain

Evidence baseline: `src/brain/state.py`, `src/brain/routers/invoke.py`, `src/brain/server.py`, `src/shared/config.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Agent state schema | missing | `AgentState` has no `org_id`. |
| Scenario: AgentState includes org_id | missing | `AgentState` has no `org_id`. |
| Scenario: Graph nodes use org_id for scoping | missing | Nodes cannot scope by org because state lacks it. |
| Requirement: FastAPI server | partial | Server exists, but org-prefixed routes and aliases are absent. |
| Scenario: Org-scoped invoke endpoint | missing | No `/api/v1/orgs/{org_id}/invoke` route exists. |
| Scenario: Legacy invoke endpoint | partial | Legacy invoke exists, but it is not wired as a `default`-org alias. |
| Requirement: Divisions.yaml configuration loader | partial | Loader exists, but only for flat single-org config. |
| Scenario: Multi-org config loading | missing | No multi-org load path exists. |
| Scenario: Legacy fallback | partial | Legacy flat config still loads. |
| Requirement: Thread ID includes org_id | missing | Thread IDs are still built without org prefix. |
| Scenario: Thread ID format | missing | No `{org_id}:...` format exists. |
| Scenario: Parse org_id from thread ID | missing | No thread-ID parser exists. |
| Requirement: Org validation middleware | missing | No org validation middleware exists. |
| Scenario: Active org accepted | missing | No middleware exists. |
| Scenario: Suspended org rejected | missing | No middleware exists. |

## gateway-architecture

Evidence baseline: `src/shared/models/requests.py`, `docker-compose.local.yml`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Unified gateway REST API contract | partial | Shared invoke contract exists, but has no `org_id`. |
| Scenario: Gateway sends org-scoped invoke | missing | Shared request model cannot carry org identity. |
| Requirement: WhatsApp gateway (Node.js/Baileys) | missing | No verified org-aware WhatsApp gateway behavior exists. |
| Scenario: WhatsApp gateway constructs org-scoped thread ID | missing | No org-prefixed thread ID contract exists. |
| Scenario: Missing NUVEX_ORG_ID | missing | No default-org fallback or warning path exists. |
| Requirement: Telegram gateway (Python) | missing | No verified org-aware Telegram gateway behavior exists. |
| Scenario: Telegram gateway uses org-scoped thread ID | missing | No org-prefixed thread ID contract exists. |
| Requirement: Email gateway (Python) | missing | No verified org-aware email gateway behavior exists. |
| Scenario: Email gateway uses org-scoped thread ID | missing | No org-prefixed thread ID contract exists. |
| Requirement: Per-channel container isolation | missing | Local compose does not encode org-aware gateway isolation. |
| Scenario: One gateway per org per channel | missing | No org-aware gateway isolation exists. |
| Requirement: Gateway backward compatibility | missing | No `NUVEX_ORG_ID` defaulting path exists. |
| Scenario: Legacy gateway without NUVEX_ORG_ID | missing | No `default`-org fallback is implemented. |

## nuvex-dashboard

Evidence baseline: `src/dashboard/frontend/src/App.tsx`, `src/dashboard/frontend/src/pages/AgentsPage.tsx`, `src/dashboard/routers/agents.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Dashboard web application | partial | Dashboard exists, but not with org-isolation features. |
| Scenario: Operator switches org | missing | No org selector exists. |
| Scenario: All-orgs overview | missing | No org overview exists. |
| Requirement: Agent status and configuration view | partial | Agent UI exists, but not org-filtered. |
| Scenario: Agent list filtered by org | missing | Frontend fetches `/api/agents` globally. |
| Requirement: Governance audit log viewer | partial | Audit view exists, but no org filter exists. |
| Scenario: Audit log for org | missing | No org filter exists. |
| Requirement: Cost analytics | partial | Cost view exists, but no org aggregation exists. |
| Scenario: Org cost summary | missing | No org aggregation exists. |
| Requirement: Organisation management page | missing | No org CRUD pages exist. |
| Scenario: Create org from dashboard | missing | No org CRUD pages exist. |
| Scenario: Suspend org from dashboard | missing | No org CRUD pages exist. |
| Requirement: Channel bindings page | missing | No channel-binding page exists. |
| Scenario: View channel bindings | missing | No channel-binding page exists. |
| Requirement: Work packets view | missing | No work-packet page exists. |
| Scenario: View work packet history | missing | No work-packet page exists. |

## policy-engine

Evidence baseline: `src/brain/governance/policy_engine.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Composable policy engine | partial | A rule engine exists, but not the org-aware three-tier merge required by this change. |
| Scenario: Three-tier merge | missing | No global→org→agent merge exists. |
| Scenario: Lower tier cannot weaken | missing | No strictness merge rules exist. |
| Requirement: Policy definitions per scope | missing | No org policy storage or loading exists. |
| Scenario: Org policy loaded from DB | missing | No org table or policy JSON exists. |
| Scenario: Agent policy overrides org | missing | No multi-tier evaluation exists. |
| Requirement: Policy evaluation order | missing | No org-aware forbidden/budget evaluation exists. |
| Scenario: Org forbidden tool stops evaluation early | missing | No org forbidden-tool list exists. |
| Requirement: Org policy management API | missing | No org policy API exists. |
| Scenario: Update org forbidden tools | missing | No org policy API exists. |

## governance-pipeline

Evidence baseline: `src/brain/governance/`, `src/brain/migrations/versions/0001_initial_schema.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: 5-stage governance pipeline as LangGraph nodes | partial | Governance pipeline exists, but not with org-isolation semantics. |
| Scenario: Policy evaluation includes org policies | missing | No org policy input exists. |
| Scenario: Forbidden tools include org-level list | missing | No org forbidden list exists. |
| Requirement: Division isolation | partial | Division logic exists, but it is not bounded by org. |
| Scenario: Division check within org | partial | Division checks exist, but without org scoping. |
| Scenario: Cross-org delegation blocked | missing | No cross-org boundary rule or work-packet redirect exists. |
| Requirement: SHA-256 audit chain | partial | Audit chain exists, but without `org_id`. |
| Scenario: Audit entry includes org_id | missing | Audit table and hook lack `org_id`. |
| Requirement: Org-level budget caps | missing | Budget checks are not org-aware. |
| Scenario: Org budget exceeded | missing | No org budget aggregate exists. |
| Scenario: Agent budget exceeded within org budget | missing | No combined org/agent budget handling exists. |

## workspace-bootstrap

Evidence baseline: `src/brain/workspace.py`, `src/brain/routers/invoke.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Workspace directory structure | missing | Workspace loader still works from a raw path string, not `(org_id, agent_id)`. |
| Scenario: Resolve workspace path for org agent | missing | No org-aware path resolution exists. |
| Scenario: Legacy workspace path fallback | missing | No fallback from org path to legacy path exists. |
| Requirement: Bootstrap file injection | partial | Prompt assembly exists, but not with org-scoped workspace resolution. |
| Scenario: System prompt includes org-scoped workspace | missing | No org-aware loader exists. |
| Requirement: First-run bootstrap protocol | partial | First-run BOOTSTRAP handling exists, but not org-scoped bootstrap creation. |
| Scenario: First-run creates org-scoped workspace | missing | No org-aware bootstrap creation exists. |
| Requirement: Org-level workspace defaults | missing | No org template support exists. |
| Scenario: Org template used for new agent | missing | No org template support exists. |
| Scenario: Fallback to global template | missing | No org template support exists. |

## task-packets

Evidence baseline: `src/brain/migrations/versions/0001_initial_schema.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Structured task packets for sub-agent delegation | partial | Task persistence exists, but not org-constrained delegation semantics. |
| Scenario: Intra-org delegation allowed | partial | Delegation concept exists, but org membership is not modeled. |
| Scenario: Cross-org delegation blocked | missing | No org-boundary check exists. |
| Requirement: Task lifecycle tracking | partial | Task persistence exists, but no org field exists. |
| Scenario: Task query scoped by org | missing | No org-scoped task query path exists. |
| Requirement: Parent-child task relationships | partial | Parent task IDs exist, but org inheritance is not modeled. |
| Scenario: Child task inherits org_id | missing | Tasks have no `org_id`. |

## agent-lifecycle

Evidence baseline: `src/brain/models/lifecycle.py`, `src/dashboard/routers/agents.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Agent registry | partial | Agent registry behavior exists, but not keyed by `(org_id, agent_id)`. |
| Scenario: Lookup agent in org | missing | Agent lookup is global. |
| Scenario: Same agent name in different orgs | missing | Agent IDs are globally unique, not org-scoped. |
| Requirement: Lifecycle event emission | partial | Lifecycle events exist, but no org context exists. |
| Scenario: Lifecycle event includes org_id | missing | Lifecycle model has no `org_id`. |
| Requirement: Agent lifecycle state machine | partial | Lifecycle states exist, but not org-scoped. |
| Scenario: Lifecycle state scoped by org | missing | Lifecycle records are keyed by agent only. |

## event-bus

Evidence baseline: `src/brain/models/events.py`, `src/dashboard/routers/events.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Structured event bus | partial | Event bus and persistence exist, but not org-aware. |
| Scenario: Event includes org_id | missing | Event model has no `org_id`. |
| Requirement: Event subscribers | partial | Subscribers exist, but no org filtering exists. |
| Scenario: Subscribe to org-specific events | missing | No org filtering exists. |
| Scenario: Subscribe to all events | partial | Global subscription capability exists. |
| Requirement: Event persistence | partial | Persistent events exist, but not org-filtered. |
| Scenario: Query event history for org | missing | Event queries cannot filter by org. |
| Requirement: Work packet events | missing | No work-packet event family exists. |
| Scenario: Work packet completion event | missing | No work-packet event family exists. |

## cron-registry

Evidence baseline: `src/brain/routers/cron.py`, `src/brain/migrations/versions/0001_initial_schema.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Cron registry for scheduled tasks | partial | Cron registry exists, but without org-scoped data. |
| Scenario: Cron entries scoped by org | missing | Cron entries have no `org_id`. |
| Requirement: Cron entry from HEARTBEAT.md | partial | HEARTBEAT participates in workspace prompt loading, but org-aware cron extraction is absent. |
| Scenario: HEARTBEAT parsed with org context | missing | No org-aware workspace or cron parsing exists. |
| Requirement: Cron management via API | partial | Cron API exists, but only as global routes. |
| Scenario: List cron entries for agent in org | missing | No org-prefixed cron route exists. |
| Requirement: Cron execution tracking | partial | Cron execution metadata exists, but not by org. |
| Scenario: Cron execution includes org_id | missing | No org field exists on cron records. |

## contact-management

Evidence baseline: `src/brain/workspace.py`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Contact files storage | missing | No org-scoped contact path resolution exists. |
| Scenario: Contact file path | missing | Workspace path is not org-aware. |
| Requirement: Contact lookup before messaging | missing | No org-boundary path validation exists. |
| Scenario: Cross-org contact lookup blocked | missing | No org-boundary path validation exists. |
| Requirement: Contact auto-refresh from message logs | missing | No org-scoped message refresh path exists. |
| Scenario: Contact refresh scoped to org | missing | No org-scoped message refresh path exists. |

## plugin-config

Evidence baseline: no verified org-aware plugin config API or loader found in `src/brain/`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Per-agent-plugin config table | partial | Related plugin infrastructure may exist outside this change, but no org-aware amendment is present here. |
| Scenario: Plugin config scoped through agent's org | missing | No org-aware scoping exists. |
| Requirement: Brain API endpoints for plugin config | missing | No org-scoped plugin config routes were found. |
| Scenario: Org-scoped plugin config endpoint | missing | No org-scoped plugin config routes were found. |
| Scenario: Agent-org mismatch rejected | missing | No org-aware routing exists. |
| Requirement: Org-level plugin enablement | missing | No org `enabled_plugins` support exists. |
| Scenario: Org allows specific plugins | missing | No org `enabled_plugins` support exists. |
| Scenario: Org with no plugin restriction | missing | No org `enabled_plugins` support exists. |
| Requirement: Plugin context excludes disabled org plugins | missing | No org-aware plugin filtering exists. |
| Scenario: Disabled plugin not in context | missing | No org-aware plugin filtering exists. |

## plugin-sdk

Evidence baseline: no verified org-aware plugin execution context found in `src/`

| Item | Status | Rationale |
| --- | --- | --- |
| Requirement: Plugin registration function | partial | Baseline plugin registration may exist, but not with org-aware runtime context. |
| Scenario: Plugin registration is org-agnostic | partial | Global plugin behavior is compatible with baseline operation, but not sufficient for the org amendment. |
| Requirement: Plugin helper utilities | missing | No `ExecutionContext` with `org_id` was found. |
| Scenario: ExecutionContext includes org_id | missing | No `ExecutionContext` with `org_id` was found. |
| Requirement: Config schema declaration | partial | Shared config schemas can exist globally, but org-aware application is absent. |
| Scenario: Config schema shared across orgs | partial | Baseline schema reuse is compatible, but org-aware enforcement is missing. |

## Summary

| Capability | Implemented | Partial | Missing |
| --- | --- | --- | --- |
| org-model | 0 | 0 | 21 |
| org-config-loader | 0 | 2 | 15 |
| org-scoped-data | 0 | 0 | 14 |
| inter-org-packets | 0 | 0 | 27 |
| channel-ownership | 0 | 0 | 13 |
| postgresql-storage | 0 | 4 | 9 |
| langgraph-brain | 0 | 4 | 11 |
| gateway-architecture | 0 | 1 | 12 |
| nuvex-dashboard | 0 | 4 | 12 |
| policy-engine | 0 | 1 | 9 |
| governance-pipeline | 0 | 4 | 7 |
| workspace-bootstrap | 0 | 2 | 8 |
| task-packets | 0 | 4 | 3 |
| agent-lifecycle | 0 | 3 | 4 |
| event-bus | 0 | 4 | 5 |
| cron-registry | 0 | 4 | 4 |
| contact-management | 0 | 0 | 6 |
| plugin-config | 0 | 1 | 9 |
| plugin-sdk | 0 | 4 | 2 |

Overall assessment: across the full `organisation-isolation` spec set, the repo shows baseline single-org infrastructure but almost none of the org-isolation amendment itself. The matrix therefore remains overwhelmingly `missing`, with `partial` used only where the underlying subsystem exists but the org-aware behavior does not.