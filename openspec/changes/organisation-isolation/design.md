## Context

NUVEX is a Python/LangGraph multi-agent platform deployed on a single Hetzner VPS. Currently all agents share one flat namespace — same PostgreSQL database, same filesystem, same gateway bindings. The proposal introduces organisation isolation: agents grouped into orgs with data isolation, org-scoped policies, per-org plugin config, channel ownership, and controlled inter-org work packets.

Existing infrastructure:
- PostgreSQL with agent-scoped tables (agents, threads, messages, budgets, etc.)
- LangGraph StateGraph with AgentState carrying `agent_id` and `thread_id`
- Workspace files at `/data/agents/{name}/workspace/`
- Gateways hardcoded to single agent via `NUVEX_AGENT_ID` env var
- Governed plugin architecture (specced, not yet implemented) with per-agent plugin config
- Policy engine with agent-level policy evaluation

Constraints:
- Single VPS deployment — no schema-per-org or DB-per-org
- Existing data must migrate to a default org with zero downtime
- All existing specs are amendment targets, not rewrite targets

## Goals / Non-Goals

**Goals:**
- Isolate agent data, threads, memory, secrets, and budgets by organisation
- Enable controlled inter-org communication via typed work packets
- Enforce channel ownership (one channel identity = one org)
- Support three-tier policy merge (global → org → agent)
- Maintain backward compatibility via default org migration
- Design for RLS upgrade path without schema changes

**Non-Goals:**
- Row-Level Security enforcement (V1 uses application-level filtering; RLS is a future upgrade)
- Org admin roles or per-org dashboard login (V1 is operator-only)
- Per-org plugin installation (plugins are global; only enablement/config is per-org)
- Multi-VPS or distributed deployment
- Cross-org agent sharing (one agent = one org, always)

## Decisions

### 1. Isolation Strategy: org_id Column + Application-Level Enforcement

All agent-scoped tables gain a non-nullable `org_id TEXT` column with a foreign key to the `organisations` table. Every query that touches agent data includes `WHERE org_id = :org_id`. No PostgreSQL RLS in V1 — enforcement is in the Python service layer.

**Why not RLS?** RLS requires setting `current_setting('app.org_id')` per connection, complicating connection pooling. Application-level is simpler for V1 and the schema is already RLS-ready when we upgrade.

**Why not schema-per-org?** Single VPS, single database. Schema-per-org adds migration complexity (N schemas × M migrations) for no isolation benefit beyond what org_id provides.

### 2. Organisation Data Model

```
organisations
├── org_id TEXT PRIMARY KEY      (kebab-case, e.g. "acme-corp")
├── name TEXT NOT NULL
├── status TEXT NOT NULL         ("active", "suspended", "archived")
├── config JSONB                 (org-level settings: default model, timezone, locale)
├── policies JSONB               (org-level policy overrides, merged with global)
├── communication_links JSONB    (declared inter-org packet routes)
├── created_at TIMESTAMPTZ
└── updated_at TIMESTAMPTZ
```

Agent table gains `org_id TEXT NOT NULL REFERENCES organisations(org_id)`. The composite natural key is `(org_id, agent_id)` but `agent_id` remains the SQLAlchemy primary key for backward compat — a unique constraint on `(org_id, agent_id)` enforces uniqueness.

### 3. Thread ID Format

**BREAKING**: `{org_id}:{agent_id}:{channel}:{participant}` replaces `{agent_id}:{channel}:{participant}`.

The org_id prefix ensures thread IDs are globally unique across orgs and enables O(1) org lookups from a thread ID without a DB query.

Migration: existing threads get the default org prefix prepended.

### 4. Workspace Path Structure

```
/data/orgs/{org_id}/agents/{agent_id}/workspace/
/data/orgs/{org_id}/config.yaml          # org-level config seed
/data/orgs/{org_id}/governance.yaml      # org-level policy overrides
/data/skills/                             # global skill library (unchanged)
/data/plugins/                            # global plugin directory (unchanged)
```

`load_workspace_files(agent_id)` becomes `load_workspace_files(org_id, agent_id)`. The function resolves `workspace_path` from the org-prefixed path.

### 5. Hybrid Config Strategy

**Boot sequence:**
1. Brain starts, reads `/data/orgs/*/config.yaml` for each org directory
2. For each org, upsert `organisations` row and agent rows in DB
3. DB becomes runtime truth — subsequent changes via API only
4. Re-reading from YAML only on explicit `nuvex config reload` CLI command

**Why hybrid?** Deploying a new org should be as simple as dropping a YAML file and restarting. But runtime management (enabling plugins, changing policies) must go through the API so the DB stays authoritative.

**Default org:** On first boot with no `/data/orgs/` directory, create a `default` org and migrate all existing agents into it. This preserves backward compat for single-org deployments.

### 6. Three-Tier Policy Merge

```
effective_policies = deep_merge(global_policies, org_policies, agent_policies)
```

Rules:
- Global policies are the floor — orgs can only make policies stricter, never weaker
- `forbidden_tools` lists are additive (union): global + org + agent
- Budget limits use the minimum of all tiers
- Policy conditions use AND logic: a tool call must pass all three tiers

This is enforced in the policy engine's `evaluate()` function. The governance pipeline nodes don't change — they call the policy engine which now merges three tiers instead of one.

### 7. Channel Ownership

Each gateway instance is configured with `NUVEX_ORG_ID` (new) + `NUVEX_AGENT_ID` (existing). The gateway sets both in the `InvokeRequest`. Brain validates that the agent belongs to the declared org.

A `channel_bindings` table maps `(channel_type, channel_identity)` → `org_id` for runtime validation. If a gateway tries to route a message to an org that doesn't own that channel, brain rejects the request.

For multi-org coverage, the front-desk org handles all inbound messages and delegates via inter-org work packets. No gateway changes needed for this pattern — it's just agent logic.

### 8. Inter-Org Work Packets

Work packets are a new message type in the event bus. They are NOT task packets (which are intra-org agent delegation).

```
work_packets
├── id UUID PRIMARY KEY
├── source_org_id TEXT NOT NULL
├── target_org_id TEXT NOT NULL
├── packet_type TEXT NOT NULL     (declared in communication_links)
├── payload JSONB NOT NULL
├── mode TEXT NOT NULL            ("sync" or "async")
├── status TEXT NOT NULL          ("pending", "processing", "completed", "failed")
├── reply_to UUID                 (for sync: references the originating packet)
├── result JSONB                  (populated when completed)
├── created_at TIMESTAMPTZ
├── completed_at TIMESTAMPTZ
└── budget_org_id TEXT            (= target_org_id, always)
```

**Dispatch flow:**
- Sync: sender agent calls a `send_work_packet` tool. Brain creates the packet, routes to target org's designated handler agent, waits for result (with timeout), returns result to sender.
- Async: same tool with `mode: async`. Brain creates the packet, routes it, returns packet_id immediately. Sender can poll or receive callback event.

**Communication links** are declared in the source org's config:
```yaml
communication_links:
  - target_org: globex
    allowed_types: [translate_doc, review_legal]
    direction: bidirectional
```

Brain validates every packet against declared links. Undeclared routes are rejected.

**Budget:** The target org's budget is consumed for processing. The source org's budget is consumed only for its own agent's work (sending the packet). No cross-billing.

### 9. Plugin Enablement Per Org

The existing `agent_plugin_config` table (from governed-plugin-architecture) already scopes config by `agent_id`. Since agents belong to orgs, plugin config is implicitly org-scoped.

Additionally, orgs can declare an `enabled_plugins` list in their config. If set, only listed plugins are loadable for agents in that org — even if an agent's config enables a plugin not in the org list, it won't load. If `enabled_plugins` is null, all globally installed plugins are available.

This means the loading check is: `plugin in org.enabled_plugins AND plugin in agent.enabled_plugins`.

### 10. API Routing

Two options considered:
- **Path prefix**: `/api/v1/orgs/{org_id}/agents/...`
- **Header/context**: `X-Org-Id` header, flat paths

**Decision: Path prefix for org-specific resources, flat for global.**

```
/api/v1/orgs                              # list all orgs (operator)
/api/v1/orgs/{org_id}                     # org details
/api/v1/orgs/{org_id}/agents              # agents in org
/api/v1/orgs/{org_id}/agents/{agent_id}   # agent detail
/api/v1/orgs/{org_id}/invoke              # invoke agent in org
/api/v1/orgs/{org_id}/threads             # threads in org
/api/v1/orgs/{org_id}/plugins             # plugin config for org
/api/v1/plugins                           # global plugin registry (unchanged)
/api/v1/health                            # global health (unchanged)
```

Existing `/api/v1/invoke` and `/api/v1/agents` endpoints remain as aliases that resolve to the default org for backward compat.

## Risks / Trade-offs

- **[Performance] org_id on every query** → All existing indexes already include agent_id; adding org_id to composite indexes is low cost. Monitor query plans after migration.
- **[Migration complexity] Thread ID format change** → Requires updating all existing thread rows and gateway configs simultaneously. Mitigation: migration script prepends default org_id; gateways updated in same deploy.
- **[Operational] YAML seed + DB truth divergence** → If someone edits YAML after boot, DB won't reflect changes until explicit reload. Mitigation: `nuvex config reload` CLI command; log warning on startup if YAML differs from DB.
- **[Security] Application-level enforcement only** → A bug in query filtering could leak cross-org data. Mitigation: centralized `org_scope()` helper that all queries must use; integration tests for isolation; RLS upgrade path documented.
- **[Complexity] Inter-org work packets** → New table, new dispatch logic, timeout handling. Mitigation: implement as a tool in the brain, not a separate service. Reuse event bus infrastructure.

## Migration Plan

1. **Schema migration**: Add `organisations` table. Add `org_id` column (nullable initially) to all agent-scoped tables.
2. **Data migration**: Create `default` org. Set `org_id = 'default'` for all existing rows.
3. **Make non-nullable**: Alter `org_id` to NOT NULL after backfill.
4. **Update indexes**: Add composite indexes including org_id.
5. **Code deploy**: Update all queries to include org_id scope. Update workspace path resolution. Update thread ID format.
6. **Gateway deploy**: Add `NUVEX_ORG_ID=default` to all gateway configs.
7. **Rollback**: Drop org_id columns, drop organisations table. Thread IDs would need prefix stripped. Rollback script provided.

## Open Questions

- Should the `send_work_packet` tool be a built-in brain tool or a governance-level mechanism? (Leaning: built-in tool, governed by policy like any other tool.)
- Should inter-org packet payload size be limited? (Leaning: yes, configurable per org, default 1MB.)
- Should there be an org-level event stream separate from the agent event bus? (Leaning: no, reuse event bus with org_id filter.)
