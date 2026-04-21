## Why

NUVEX interacts with unknown external people via WhatsApp, Telegram, and email, but currently has no structured concept of who those people are, how much to trust them, or what they're permitted to do — contact identity is stored as ad-hoc markdown files and raw sender JIDs, with no governance enforcement. This creates a security gap (all senders are treated equally), prevents personalised multi-human interactions (no relationship memory), and makes it impossible to systematically protect the system from social engineering or abuse.

## What Changes

- Introduce a `contacts` DB table that unifies channel handles (phone, email, Telegram ID) into a single tracked person, scoped per org
- Introduce a `principals` DB table for Class A system users (owner, admin, operator, member) who authenticate to the dashboard/API — separated from channel-based contacts
- Add progressive trust tiers (T0–T3) to contacts, governing what agents will do or reveal for that person
- Add a sanctions model (under_review, shadowban, temp_ban, hard_ban) as an orthogonal axis to trust — "known but blocked"
- Add a `contact_relationships` table to record social graph connections between contacts (colleague, vouching, referred_by, customer) — used as framing context by agents, never as automatic trust elevation
- Add a `contact_context` table for per-agent relationship memory (preferences, known topics, interaction notes) injected into system prompts
- Add identity resolution at message intake: raw sender handle → resolved contact record → trust tier + sanction loaded into `AgentState`
- Add an identity gate governance stage that enforces tier and sanction restrictions before tools run
- **BREAKING**: All gateways must populate `sender_name` in `MessageMetadata` where available (WhatsApp push name, Telegram first_name, email From display name)
- Introduce `Gatekeeper` — a system agent (`system: true`, non-deletable) that handles trust elevation/demotion via structured conversational intake, accessible only to Class A principals and T3 contacts
- Add `system: true` flag to agent config and enforce non-deletion/non-suspension in governance layer

## Capabilities

### New Capabilities

- `contact-identity`: Unified contact model — `contacts` + `contact_handles` tables, contact auto-creation on first message, handle resolution service, CRM adapter interface
- `trust-tiers`: Trust tier progression (T0→T3) on contacts, configurable progression rules, tier enforcement in AgentState and system prompt injection
- `sanctions`: Sanction model (under_review, shadowban, temp_ban, hard_ban), sanction enforcement at governance layer, auto-triggers for known abuse patterns
- `contact-relationships`: Social graph model (`contact_relationships` table), relationship-as-context injection, vouching flow (T3 vouches → admin reviews → promotion possible)
- `relationship-memory`: Per-agent contact context store (`contact_context` table), confidence-scored entries, system prompt injection, review-reminder scheduling
- `principals`: Class A system user model (`principals` table), role-based (owner/admin/operator/member), principal↔contact linkage
- `gatekeeper-agent`: Non-deletable `Gatekeeper` system agent, trust intake conversation flow, promote/demote/freeze/sanction tools, audit logging, 90-day review reminders
- `system-agents`: `system: true` flag in divisions.yaml, governance enforcement of non-deletion/non-suspension, system agent UI section in dashboard

### Modified Capabilities

- `governance`: New identity gate stage injected before existing forbidden/budget checks — reads contact trust tier + sanction from AgentState, blocks or restricts accordingly

## Impact

- **New DB tables**: `principals`, `contacts`, `contact_handles`, `contact_relationships`, `contact_context` (migration 0007)
- **Modified DB tables**: `agents` — add `system BOOL DEFAULT false`
- **Modified `AgentState`**: add `contact_trust_tier`, `contact_sanction`, `contact_id` fields
- **Modified `MessageMetadata`**: `sender_name` begins being populated (all gateways)
- **Modified governance pipeline**: new identity gate stage in `src/brain/governance/`
- **Modified `divisions.yaml`**: `gatekeeper` system agent added; `system: true` flag supported
- **New tools**: `resolve_contact`, `promote_contact`, `demote_contact`, `apply_sanction`, `lift_sanction`, `record_relationship`, `query_contact_history`, `schedule_review_reminder`
- **Modified workspace/system prompt assembly**: contact context injection
- **Dashboard**: System Agents section, Contact directory page, trust tier + sanction controls
