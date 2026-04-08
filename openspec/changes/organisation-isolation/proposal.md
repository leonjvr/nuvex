## Why

NUVEX currently operates as a single-org, multi-agent deployment. All agents share one flat namespace — same database rows, same filesystem, same gateway bindings. This prevents deploying NUVEX for multiple client organisations on one instance, and prevents enterprises from isolating departments where data boundaries matter. Agents in one org must never see threads, memory, secrets, or budget pools belonging to another org. Additionally, organisations need controlled inter-org communication via explicit work packets without leaking ambient context.

## What Changes

- **New `organisations` table** — each org has an `org_id`, name, config, and status. All agent-scoped tables gain an `org_id` column with application-level enforcement (RLS-ready schema).
- **Agent-to-org binding** — every agent belongs to exactly one org. Agent identifiers become `(org_id, agent_id)` composite. No agent can belong to multiple orgs.
- **Org-scoped workspace paths** — workspace files move from `/data/agents/{name}/workspace/` to `/data/orgs/{org_id}/agents/{name}/workspace/`.
- **Channel ownership rule** — each channel identity (WhatsApp number, Telegram bot, email address) belongs to exactly one org. A channel cannot be shared across orgs. Multi-org coverage uses a front-desk delegation pattern where the owning org routes work packets to other orgs.
- **Thread ID format change** — **BREAKING**: thread IDs change from `{agent_id}:{channel}:{participant}` to `{org_id}:{agent_id}:{channel}:{participant}`.
- **Three-tier policy merge** — governance policies resolve as: global defaults → org-level overrides → agent-level overrides. Orgs can add policies but cannot weaken global policies.
- **Org-scoped budgets** — each org has its own budget pool. Agents consume their org's budget. No cross-org billing.
- **Inter-org work packets** — controlled, explicit communication between orgs via typed work packets. Supports sync (blocking) and async (fire-and-forget with callback) modes. Only declared communication links are allowed.
- **Plugin enablement per org** — plugins remain globally installed but are enabled/configured per org. Disabled plugins are not loaded into agent context or memory for that org.
- **Hybrid config** — YAML files seed org definitions on first boot; database becomes runtime source of truth. LLMs can create/modify orgs via API.
- **Operator dashboard** — V1 dashboard shows all orgs (operator view). Org isolation is a behavioral boundary for agents, not a dashboard access control boundary.

## Capabilities

### New Capabilities
- `org-model`: Organisation data model — DB table, Pydantic models, org CRUD operations, org-agent binding, org lifecycle
- `org-config-loader`: Hybrid config loader — YAML seed files per org, DB sync, runtime config API, org-scoped divisions.yaml resolution
- `org-scoped-data`: Data isolation layer — org_id propagation on all tables, application-level query scoping, migration from flat to org-scoped schema
- `inter-org-packets`: Inter-org work packet protocol — packet types, communication links, sync/async dispatch, result callbacks, audit trail, budget attribution
- `channel-ownership`: Channel-to-org binding — one channel identity per org, gateway org routing, front-desk delegation pattern

### Modified Capabilities
- `postgresql-storage`: Add org_id column to all agent-scoped tables, add organisations table, update indexes and foreign keys
- `langgraph-brain`: AgentState gains org_id; thread ID format changes; graph node context includes org
- `workspace-bootstrap`: Workspace path prefix changes to `/data/orgs/{org_id}/agents/{name}/workspace/`
- `governance-pipeline`: Three-tier policy merge (global → org → agent); cross-org tool blocking
- `policy-engine`: Org-level policy definitions; merge precedence with global and agent policies
- `agent-lifecycle`: Agent registry keyed by (org_id, agent_id); lifecycle events include org context
- `gateway-architecture`: Gateway instances bind to one org; thread ID format includes org_id
- `task-packets`: Task delegation validates target agent is in same org (or uses inter-org packet for cross-org)
- `event-bus`: Events include org_id; subscribers can filter by org
- `nuvex-dashboard`: All API endpoints gain org context; operator can view/switch orgs
- `plugin-config`: AgentPluginConfig scoped via org_id on agent; plugin enablement per org
- `contact-management`: Contact lookup scoped to agent's org
- `cron-registry`: Cron entries org-scoped; HEARTBEAT parsing per org/agent
- `plugin-sdk`: ExecutionContext includes org_id; PluginAPI methods receive org context

## Impact

- **Database**: Migration adds org_id to 12+ tables, creates organisations table, updates all indexes. Existing single-org data migrates to a default org.
- **API surface**: All agent-scoped endpoints gain org context (via path parameter or header). **BREAKING** for existing API consumers.
- **Gateway code**: Each gateway instance configured with `NUVEX_ORG_ID`. Thread ID format change requires gateway update.
- **Config files**: `divisions.yaml` evolves to per-org config files or nested org structure. Backward-compatible via default org.
- **Workspace filesystem**: Directory structure changes from flat agent paths to org-prefixed paths.
- **Plugin system**: governed-plugin-architecture amendments for org-scoped enablement and config.
- **Brain runtime**: AgentState, graph nodes, hook context all carry org_id. Minimal logic change — mostly threading the parameter through.
