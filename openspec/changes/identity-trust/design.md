## Context

NUVEX currently treats all inbound senders as anonymous strings — a raw JID, Telegram numeric ID, or email address. There is no unified concept of a person across channels, no trust model, no access control applied at the contact level, and no persistent relationship memory. Agent Maya stores contacts as flat markdown files in her workspace; these are not queryable, not org-scoped, and invisible to other agents or the governance layer.

The governance pipeline today enforces rules about what agents can do (forbidden commands, budget, tool approvals) but has no concept of *who is asking*. A stranger and the system owner are treated identically at the code layer.

This design introduces a three-layer identity model — contact identity, progressive trust, and relationship memory — alongside a separated principal model for system operators, all enforced by a new governance stage and managed via a non-deletable Gatekeeper system agent.

## Goals / Non-Goals

**Goals:**
- Unify cross-channel sender handles into a single `contacts` record per org
- Enforce progressive trust (T0–T3) and sanctions as structural constraints — not LLM judgements
- Give agents framing context (who they're talking to, relationship graph, preferences) via system prompt injection
- Separate system operators (Class A principals) from channel-facing contacts
- Introduce Gatekeeper as the human-in-the-loop for trust decisions, reachable via any channel
- Protect system agents from deletion/suspension via `system: true` enforcement in governance

**Non-Goals:**
- Building a full CRM — the CRM adapter interface is a placeholder; integration with real CRMs is a future change
- Authentication/SSO for principals — principals table is created but login flow is out of scope here (handled when dashboard auth is built)
- Per-tool permission ACLs at the contact level — tier-based restrictions are coarse-grained; fine-grained tool ACLs are a future extension
- Contact deduplication / merge — if the same person uses two channels, they have two handle rows; merge is a future feature

## Decisions

### Decision 1: Contacts and Principals are separate tables

**Chosen**: Two separate tables (`contacts` for channel-based people, `principals` for system operators), linked by an optional FK `contacts.principal_id → principals.id`.

**Rationale**: The identity models are fundamentally different. A principal has credentials and a role in the system's management layer. A contact has a channel handle and a trust tier in the system's interaction layer. Many contacts will never be principals. Some principals (the owner) are also contacts. Merging them creates awkward nullable columns and blurs the RBAC/trust distinction.

**Alternative considered**: Single `users` table with a `type` enum. Rejected — conflates authentication (principals) with interaction trust (contacts), and makes org isolation harder since principals need their own auth scope.

### Decision 2: Trust tier and sanction are orthogonal columns

**Chosen**: `contacts.trust_tier ENUM(T0..T3)` and `contacts.sanction ENUM(null, under_review, shadowban, temp_ban, hard_ban)` are independent columns. Sanction takes precedence over tier in the governance gate.

**Rationale**: A T2 trusted customer can be sanctioned without losing their trust tier history. Lifting a shadowban restores them to T2 immediately, without needing to re-earn tier. Conflating the two (e.g. a "banned" tier) would require history tracking of pre-ban tier to restore correctly.

### Decision 3: Identity resolution happens at brain intake, not at the gateway

**Chosen**: Gateways send enriched `sender` + `sender_name` in `MessageMetadata`. Contact resolution (handle → contact record) happens in `src/brain/routers/invoke.py` before the graph runs, loading the contact into `AgentState`.

**Rationale**: Keeping resolution in the brain keeps gateways stateless and simple. Gateways don't need DB access. Resolution logic is centralised and testable. Gateways only need to pass the best available display name (`sender_name`).

**Alternative considered**: Gateway-side resolution (gateway calls a `/contacts/resolve` endpoint before forwarding). Rejected — adds latency, gateway complexity, and a coupling point. The gateway should be a thin transport layer.

### Decision 4: Relationship graph is signal, not authority

**Chosen**: `contact_relationships` records associations between contacts. The governance layer and system prompt injection can read these. They cannot trigger automatic trust promotion.

**Rationale**: Automatic trust-by-association is a social engineering vector. "I'm Leon's colleague" must not auto-elevate a contact. Relationships provide framing context and enable a vouching *request* flow (T3 vouches → admin reviews → admin promotes). The decision gate is always a Class A human.

### Decision 5: Gatekeeper is a `system: true` agent defined in divisions.yaml

**Chosen**: Gatekeeper is a normal agent entry in `divisions.yaml` with an additional `system: true` flag. The governance layer enforces non-deletion and non-suspension for flagged agents.

**Rationale**: Using the same agent config format avoids a special code path. `system: true` is a minimal addition. The agent has a restricted `access_restriction` block that limits which contacts can invoke it. Dashboard renders system agents in a separate section.

**Alternative considered**: Hardcoding Gatekeeper in Python. Rejected — breaks the configuration-driven architecture and makes it impossible for operators to adjust Gatekeeper's prompt or tools without code changes.

### Decision 6: Contact context (relationship memory) uses a scored, time-aware table

**Chosen**: `contact_context` rows have a `confidence FLOAT` (0.0–1.0) and `last_referenced TIMESTAMPTZ`. Confidence decays passively; rows that haven't been referenced in 90 days are candidates for pruning.

**Rationale**: Relationship memory should reflect recency. A preference noted 2 years ago is less reliable than one from last week. Confidence decay makes stale context less prominent without deleting history. The decay is passive (calculated at read time or via a background cron), not an active scheduler.

## Risks / Trade-offs

- **[Risk] Identity resolution adds latency to every invocation** → Mitigation: use a read-through cache (contact record cached by `(org_id, channel_type, handle)` with a short TTL, e.g. 30 seconds). Cache invalidated on any trust/sanction write.

- **[Risk] Auto-created T0 contacts accumulate for high-volume channels** → Mitigation: configurable `auto_create_contacts: true/false` per org; if false, unknown senders are handled as anonymous T0 without a DB row.

- **[Risk] Sanction evasion by changing channel handle (new SIM, new email)** → Mitigation: this is an inherent limitation of handle-based identity. Mitigation is operator awareness and CRM-level identity (future). No pretense of being foolproof at T0.

- **[Risk] Gatekeeper's LLM reasoning could be manipulated during intake conversation** → Mitigation: Gatekeeper's tools are the authority — the LLM facilitates the conversation but the `promote_contact` tool requires explicit `confirmed: true` parameter. The LLM cannot promote without calling the tool. The tool validates that the caller is a Class A principal or T3 contact.

- **[Risk] `system: true` governance enforcement could be bypassed via direct DB writes** → Accepted trade-off: no system prevents DB-level bypasses — this is out of scope. The governance enforcement is at the API/agent layer.

## Migration Plan

1. Deploy migration 0007 (new tables, agents.system column) — additive only, no existing column changes
2. Existing contacts table: none to migrate (contacts table is new)
3. Existing `agents` table: backfill `system = false` for all rows (migration does this)
4. Update `divisions.yaml` to add `gatekeeper` agent and `system: true` flag syntax
5. Deploy updated brain and all gateways (gateways must send `sender_name`)
6. No rollback complexity — new tables can be dropped with no data loss to existing features

## Open Questions

- **Principal login flow**: How do principals authenticate to the dashboard? OAuth? Email magic link? This design creates the `principals` table but defers the auth mechanism to the dashboard-auth change.
- **Cross-org principal**: Can an owner principal manage multiple orgs? For now, one principal per org. Multi-org management is a future concern.
- **CRM adapter interface**: Defined as a config key (`crm_adapter: null`) but not implemented here. Should the interface be defined as an abstract base class now, or wait until a real CRM integration is needed?
