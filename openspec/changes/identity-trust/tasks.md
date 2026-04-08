## 1. Database Migration

- [ ] 1.1 Create migration `0007_identity_trust.py`: add `principals`, `contacts`, `contact_handles`, `contact_relationships`, `contact_context` tables; add `system BOOLEAN DEFAULT false` to `agents`; backfill `agents.system = false`
- [ ] 1.2 Add SQLAlchemy models: `Principal` (`src/brain/models/principal.py`), `Contact` + `ContactHandle` (`src/brain/models/contact.py`), `ContactRelationship` (`src/brain/models/contact_relationship.py`), `ContactContext` (`src/brain/models/contact_context.py`)
- [ ] 1.3 Add `system: bool = False` field to `Agent` model (`src/brain/models/agent.py`)

## 2. Contact Identity & Resolution

- [ ] 2.1 Implement `ContactResolver` service (`src/brain/identity/resolver.py`): given `(org_id, channel_type, handle, sender_name)`, resolve or auto-create contact; return `ContactResolution(contact_id, trust_tier, sanction, sanction_until)`
- [ ] 2.2 Add read-through cache to `ContactResolver` (TTL 30 seconds, keyed on `(org_id, channel_type, handle)`); invalidate cache on any trust/sanction write
- [ ] 2.3 Add `contact_id`, `contact_trust_tier`, `contact_sanction` fields to `AgentState` (`src/brain/state.py`)
- [ ] 2.4 Call `ContactResolver` in `src/brain/routers/invoke.py` before graph runs; populate `AgentState` fields

## 3. Gateway: Populate sender_name

- [ ] 3.1 WhatsApp gateway (`src/gateway/whatsapp/src/bot.js`): set `metadata.sender_name` to push name from `msg.pushName` or `contact.notify`
- [ ] 3.2 Telegram gateway (`src/gateway/telegram/bot.py`): set `sender_name` to `first_name + last_name` from `message.from_user`
- [ ] 3.3 Email gateway (`src/gateway/email/poller.py`): parse `From` header display name; set `sender_name`

## 4. Trust Tier Progression

- [ ] 4.1 Implement `TrustProgressionService` (`src/brain/identity/progression.py`): check T0→T1 auto-promotion thresholds (min_messages, min_days) against message count from threads; write promotion + audit entry
- [ ] 4.2 Register progression check as a post-invocation hook (call after each successful invocation for T0 contacts)
- [ ] 4.3 Load progression config from `divisions.yaml` / `nuvex.yaml` via `get_cached_config()`

## 5. Governance Identity Gate

- [ ] 5.1 Create `src/brain/governance/identity_gate.py`: reads `AgentState.contact_trust_tier` and `contact_sanction`; returns `GovernanceDecision` (pass / block / restrict_tools / shadowban)
- [ ] 5.2 Handle `temp_ban` expiry: if `sanction=temp_ban` and `sanction_until` has passed, clear sanction in DB + state and allow through
- [ ] 5.3 Queue admin notification event for `under_review` contacts (deduplicated — one per contact per 24h)
- [ ] 5.4 Wire identity gate as the first stage in the governance pipeline (`src/brain/governance/pipeline.py` or equivalent)
- [ ] 5.5 Handle auto-trigger patterns (`auto_under_review_on`) — on forbidden governance hit for T0, apply `under_review` automatically if configured

## 6. System Prompt Contact Injection

- [ ] 6.1 Extend `src/brain/workspace.py` (or equivalent system prompt builder): load contact display name, trust tier, sanction status, and relationships from DB
- [ ] 6.2 Load `contact_context` rows for `(agent_id, contact_id)` with confidence ≥ 0.5; inject as "Known context" block
- [ ] 6.3 Update `last_referenced` timestamp on each used `contact_context` row
- [ ] 6.4 Implement confidence decay calculation (read-time: multiply confidence by decay factor based on days since `last_referenced`)

## 7. System Agents Enforcement

- [ ] 7.1 Add `system: bool` to agent config Pydantic model (`src/shared/config.py` or equivalent)
- [ ] 7.2 Add `system: true` Gatekeeper entry to `config/divisions.yaml`
- [ ] 7.3 Enforce `system: true` protection in `src/brain/routers/agents.py`: block DELETE, block `lifecycle_state=suspended`, block empty tool list update — return HTTP 403, write audit log entry
- [ ] 7.4 Dashboard: render system agents in separate "System Agents" section; hide/disable delete and suspend controls for system agents

## 8. Principals

- [ ] 8.1 Create `GET/POST /api/principals` and `PATCH/DELETE /api/principals/{id}` endpoints in `src/brain/routers/principals.py` (or dashboard router if appropriate)
- [ ] 8.2 Enforce one-owner-per-org constraint in the principals router
- [ ] 8.3 Implement principal→contact effective tier calculation in `ContactResolver` (owner link → T3 floor; admin link → T2 floor)
- [ ] 8.4 Dashboard: principals management page (list, add, change role, link to contact)

## 9. Gatekeeper Agent Tools

- [ ] 9.1 Implement `resolve_contact` tool: look up a contact by name or handle; return identity summary
- [ ] 9.2 Implement `promote_contact` tool: validate caller auth level, validate tier ceiling, write tier change + audit entry, clear cache
- [ ] 9.3 Implement `demote_contact` tool: same validation, write demotion + audit entry
- [ ] 9.4 Implement `apply_sanction` tool: validate caller auth (hard_ban: owner only), write sanction, log reason
- [ ] 9.5 Implement `lift_sanction` tool: validate caller auth (hard_ban: owner only), clear sanction, log
- [ ] 9.6 Implement `record_relationship` tool: create `contact_relationships` row
- [ ] 9.7 Implement `query_contact_history` tool: return last N trust/sanction events for a contact from audit log
- [ ] 9.8 Implement `schedule_review_reminder` tool: create cron entry for 90-day reminder notification
- [ ] 9.9 Add access restriction check at tool entry: validate `caller_trust_tier >= T3` or `caller_principal_role in (operator, admin, owner)`

## 10. Contact Directory API & Dashboard

- [ ] 10.1 Create `GET /api/contacts` (paginated, filterable by tier/sanction) and `GET /api/contacts/{id}` endpoints
- [ ] 10.2 Create `GET /api/contacts/{id}/history` endpoint: returns trust tier and sanction change events from audit log
- [ ] 10.3 Dashboard: Contact directory page — list contacts with tier, sanction badge, channel handles, last seen
- [ ] 10.4 Dashboard: Contact detail page — tier controls (promote/demote, admin ceiling enforced), sanction controls, relationship list, context entries

## 11. Unit Tests

- [ ] 11.1 `unit-tests/identity/test_resolver.py`: auto-create T0 contact, return existing, anonymous fallback, sender_name used for display_name
- [ ] 11.2 `unit-tests/identity/test_progression.py`: T0→T1 threshold check, T1→T2 blocked without manual, T3 owner-only
- [ ] 11.3 `unit-tests/identity/test_identity_gate.py`: hard_ban blocks, temp_ban clears on expiry, shadowban restricts, under_review blocks tools, T0 blocks tools, T1+ passes
- [ ] 11.4 `unit-tests/identity/test_gatekeeper_tools.py`: promote_contact auth check, apply_sanction hard_ban owner-only, lift_sanction, tool rejects T1 caller
- [ ] 11.5 `unit-tests/identity/test_system_agents.py`: system: true blocks delete + suspend via API
- [ ] 11.6 Full suite must remain green: `python -m pytest unit-tests/ --tb=short -q --ignore=unit-tests/integration`
