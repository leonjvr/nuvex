## 1. Organisation Data Model

- [x] 1.1 Create `src/brain/models/organisation.py` — SQLAlchemy `Organisation` model with columns: org_id (TEXT PK), name (TEXT NOT NULL), status (TEXT NOT NULL default "active"), config (JSONB), policies (JSONB), communication_links (JSONB), created_at, updated_at
- [x] 1.2 Create `src/shared/models/organisation.py` — Pydantic models: `Organisation`, `OrganisationCreate` (org_id regex `^[a-z0-9][a-z0-9-]*[a-z0-9]$`, max 64 chars), `OrganisationUpdate`
- [x] 1.3 Implement organisation status lifecycle — enforce transitions: active → suspended → archived; reject invalid transitions
- [x] 1.4 Add `org_id TEXT NOT NULL` column to `agents` table with FK to `organisations.org_id`; add unique constraint on (org_id, agent_id)
- [x] 1.5 Register Organisation model in `src/brain/models_registry.py`

## 2. Database Migration

- [x] 2.1 Write Alembic migration: CREATE TABLE `organisations` with all columns and indexes
- [x] 2.2 Write Alembic migration: ADD COLUMN `org_id` (nullable) to all agent-scoped tables (agents, threads, messages, budgets, tasks, governance_audit, cron_entries, events, agent_lifecycle, memories, actions_queue)
- [x] 2.3 Write data migration: INSERT "default" org; UPDATE all existing rows SET org_id = "default"
- [x] 2.4 Write Alembic step: ALTER COLUMN org_id SET NOT NULL on all tables; ADD FK constraints
- [x] 2.5 Update all existing indexes to composite (org_id, agent_id) as leading columns; add standalone org_id indexes
- [x] 2.6 CREATE TABLE `work_packets` with all columns from inter-org-packets spec
- [x] 2.7 CREATE TABLE `channel_bindings` with unique constraint on (channel_type, channel_identity)
- [x] 2.8 Write rollback migration: drop org_id columns, drop organisations/work_packets/channel_bindings tables

## 3. Org-Scoped Data Access Layer

- [x] 3.1 Create `src/brain/org_scope.py` — implement `org_scope(query, org_id)` helper that adds WHERE org_id = :org_id to any SQLAlchemy query
- [x] 3.2 Refactor all data access functions in `src/brain/` to use `org_scope()` — threads, messages, budgets, tasks, events, audit, cron, lifecycle
- [x] 3.3 Update `get_agent()` to accept `(org_id, agent_id)` — return 404 if agent not in declared org
- [x] 3.4 Implement cross-org access prevention: thread lookups validate org_id from thread ID prefix matches request org

## 4. Organisation Config Loader

- [x] 4.1 Implement per-org YAML reader — scan `/data/orgs/*/config.yaml`, parse each into org + agent definitions
- [x] 4.2 Implement YAML-to-DB sync — upsert organisations and agents rows from YAML on boot; log changes
- [x] 4.3 Implement legacy fallback — if no `/data/orgs/` exists, load `config/nuvex.yaml` or `divisions.yaml` into "default" org
- [x] 4.4 Implement default org auto-creation — on boot with no orgs in DB and no YAML, create "default" org
- [x] 4.5 Implement per-org governance.yaml loading — read optional `/data/orgs/{org_id}/governance.yaml` into org policies JSONB
- [x] 4.6 Implement `nuvex config reload` CLI command — re-read all YAML seeds, sync to DB, print change summary
- [x] 4.7 Implement divergence warning — on boot, if YAML differs from DB, log warning with recommended action

## 5. AgentState & Thread ID Format

- [x] 5.1 Add `org_id: str` field to `AgentState` TypedDict in `state.py`
- [x] 5.2 Update thread ID format to `{org_id}:{agent_id}:{channel}:{participant}` — update all thread ID construction sites
- [x] 5.3 Implement `parse_thread_id(thread_id)` utility returning (org_id, agent_id, channel, participant)
- [x] 5.4 Update graph node functions to read org_id from state and pass to data access functions
- [x] 5.5 Write thread ID migration — prepend "default:" to all existing thread IDs in the threads table

## 6. Brain Server & API Routing

- [x] 6.1 Create `src/brain/routers/orgs.py` — CRUD endpoints: POST/GET/PUT/DELETE for `/api/v1/orgs` and `/api/v1/orgs/{org_id}`
- [x] 6.2 Update `src/brain/routers/invoke.py` — add `/api/v1/orgs/{org_id}/invoke` endpoint; keep legacy `/api/v1/invoke` as alias for default org
- [x] 6.3 Update `src/brain/routers/agents.py` — add `/api/v1/orgs/{org_id}/agents` endpoints; keep legacy routes as default-org aliases
- [x] 6.4 Update `src/brain/routers/threads.py` — add `/api/v1/orgs/{org_id}/threads` endpoints
- [x] 6.5 Implement org validation middleware — check org exists and is active; return 403 for suspended/archived orgs
- [x] 6.6 Mount orgs router in `server.py`; update lifespan to run config loader and default-org creation
- [x] 6.7 Add `GET /api/v1/orgs/{org_id}/policies` and `PUT /api/v1/orgs/{org_id}/policies` endpoints

## 7. Three-Tier Policy Merge

- [x] 7.1 Implement `merge_policies(global_policies, org_policies, agent_policies)` — forbidden_tools: union; budgets: minimum; conditions: AND logic
- [x] 7.2 Update policy engine `evaluate()` to load and merge three tiers before evaluation
- [x] 7.3 Update `check_forbidden` node to check global + org + agent forbidden tool lists (union)
- [x] 7.4 Update `check_budget` node to enforce org-level daily budget cap alongside agent-level cap
- [x] 7.5 Implement org budget tracking — aggregate daily spend across all agents in org

## 8. Workspace Path Update

- [x] 8.1 Update `workspace.py` `load_workspace_files()` to accept `(org_id, agent_id)` and resolve path to `/data/orgs/{org_id}/agents/{agent_id}/workspace/`
- [x] 8.2 Implement legacy path fallback — if org is "default" and org-scoped path doesn't exist, fall back to `/data/agents/{agent_id}/workspace/`
- [x] 8.3 Update `assemble_system_prompt()` to pass org_id through to workspace loader
- [x] 8.4 Update first-run bootstrap to create workspace at org-scoped path
- [x] 8.5 Implement org-level templates — check `/data/orgs/{org_id}/templates/` before global defaults for bootstrap files

## 9. Gateway Updates

- [x] 9.1 Update WhatsApp gateway — read `NUVEX_ORG_ID` env var; include org_id in InvokeRequest; construct thread IDs with org prefix
- [x] 9.2 Update Telegram gateway — read `NUVEX_ORG_ID` env var; include org_id in InvokeRequest; construct thread IDs with org prefix
- [x] 9.3 Update Email gateway — read `NUVEX_ORG_ID` env var; include org_id in InvokeRequest; construct thread IDs with org prefix
- [x] 9.4 Add `org_id: str` field to `InvokeRequest` Pydantic model in `requests.py`
- [x] 9.5 Implement backward compat — if `NUVEX_ORG_ID` not set, default to "default" and log deprecation warning
- [x] 9.6 Update `docker-compose.local.yml` — add `NUVEX_ORG_ID=default` to all gateway services

## 10. Channel Ownership

- [x] 10.1 Create `src/brain/models/channel_binding.py` — SQLAlchemy model with unique constraint on (channel_type, channel_identity)
- [x] 10.2 Create `src/brain/routers/channels.py` — POST/GET/DELETE endpoints under `/api/v1/orgs/{org_id}/channels`
- [x] 10.3 Implement channel validation in invoke flow — brain validates org_id + channel identity match a channel binding
- [x] 10.4 Implement auto-binding from gateway config on boot — upsert channel_binding when gateway registers
- [x] 10.5 Mount channels router in `server.py`

## 11. Inter-Org Work Packets

- [x] 11.1 Create `src/brain/models/work_packet.py` — SQLAlchemy model matching the inter-org-packets spec
- [x] 11.2 Implement communication links validation — check source org's communication_links before creating packet
- [x] 11.3 Implement sync dispatch flow — create packet, invoke target org's handler agent, wait with timeout, return result
- [x] 11.4 Implement async dispatch flow — create packet, return packet_id immediately, invoke handler asynchronously
- [x] 11.5 Implement `send_work_packet` built-in tool — accepts target_org, packet_type, payload, mode; subject to governance
- [x] 11.6 Implement packet handler routing — read target org's `packet_handler_agent` from config; invoke that agent with packet as task
- [x] 11.7 Implement packet status transitions — pending → processing → completed/failed/timeout; update DB and emit events
- [x] 11.8 Implement payload size validation — reject packets exceeding org's configured limit (default 1MB)
- [x] 11.9 Implement work packet audit trail — log packet lifecycle transitions in governance audit
- [x] 11.10 Create `src/brain/routers/work_packets.py` — GET endpoints for packet listing and status; mount in server.py

## 12. Plugin System Amendments

- [x] 12.1 Add `org_id: str` to `ExecutionContext` in plugin SDK
- [x] 12.2 Implement org-level plugin enablement — check org's `enabled_plugins` list before loading plugin tools for agent
- [x] 12.3 Update plugin loader to skip plugins not in org's enabled list when building agent tool set
- [x] 12.4 Update plugin config API endpoints to org-scoped paths: `/api/v1/orgs/{org_id}/agents/{agent_id}/plugins/{plugin_id}`

## 13. Governance & Audit Updates

- [x] 13.1 Add `org_id` to governance audit entries — update audit_hook and SHA-256 chain to include org_id
- [x] 13.2 Update HookContext to include `org_id` field
- [x] 13.3 Update audit query endpoints to scope by org_id
- [x] 13.4 Update division isolation to operate within org boundary only — cross-org always blocked at query level

## 14. Dashboard — Organisation Support

- [ ] 14.1 Create organisations list page — show all orgs with name, status badge, agent count, channel count, daily spend
- [ ] 14.2 Add org selector to dashboard header — switch between orgs or select "All Organisations"
- [ ] 14.3 Update agent list/detail pages to filter by selected org
- [ ] 14.4 Update thread viewer to filter by selected org
- [ ] 14.5 Update audit log viewer to filter by selected org; show cross-org work packets in both org views
- [ ] 14.6 Update cost analytics to support org-level aggregation
- [ ] 14.7 Build channel bindings management page per org
- [ ] 14.8 Build work packets history page with filters for source/target org, status, type
- [ ] 14.9 Build org create/edit/suspend forms

## 15. Cron & Event Bus Updates

- [x] 15.1 Add org_id to cron entries; update cron queries with org_scope
- [x] 15.2 Update HEARTBEAT.md parser to tag cron entries with agent's org_id
- [x] 15.3 Update cron API endpoints to org-scoped paths
- [x] 15.4 Add org_id to event bus payloads; update event subscribers to support org filtering
- [x] 15.5 Implement work packet events — work_packet.created/.processing/.completed/.failed/.timeout

## 16. Task Packets Amendment

- [x] 16.1 Add org_id to task packet records
- [x] 16.2 Implement intra-org validation — task delegation only permitted if target agent has same org_id
- [x] 16.3 Return error message directing to send_work_packet for cross-org attempts

## 17. Contact Management Amendment

- [x] 17.1 Update contact file paths to use org-scoped workspace: `/data/orgs/{org_id}/agents/{agent_id}/workspace/contacts/`
- [x] 17.2 Validate contact lookup paths stay within agent's org workspace
- [x] 17.3 Update contact auto-refresh to scope message queries by org_id

## 18. Testing

- [x] 18.1 Write unit test for Organisation Pydantic model — valid/invalid org_id, status transitions
- [x] 18.2 Write unit test for org_scope helper — correct WHERE clause appended, covers all table types
- [x] 18.3 Write unit test for merge_policies — forbidden_tools union, budget minimum, condition AND, weakening prevention
- [x] 18.4 Write unit test for thread ID parsing — format validation, org_id extraction, legacy format detection
- [x] 18.5 Write unit test for config loader — YAML scan, DB sync, legacy fallback, divergence detection
- [x] 18.6 Write unit test for communication links validation — allowed types, undeclared org, undeclared type
- [x] 18.7 Write unit test for channel binding uniqueness — duplicate rejection, valid binding, auto-binding
- [ ] 18.8 Write integration test for cross-org data isolation — org A cannot see org B's threads, messages, budgets
- [ ] 18.9 Write integration test for inter-org sync work packet — create, dispatch, receive, return result
- [ ] 18.10 Write integration test for inter-org async work packet — create, dispatch, poll, complete
- [ ] 18.11 Write integration test for three-tier policy merge — global + org + agent, strictest wins
- [ ] 18.12 Write integration test for org-level budget cap — org exceeds budget, agent still under agent limit
- [ ] 18.13 Write integration test for channel ownership — binding enforced, duplicate rejected, cross-org rejected
- [ ] 18.14 Write integration test for default org migration — existing data migrated, thread IDs prefixed, backward compat routes work
- [ ] 18.15 Write integration test for org lifecycle — create, suspend (invokes blocked), archive (read-only)
- [ ] 18.16 Write integration test for plugin org enablement — org whitelist blocks non-listed plugins

