# Governance Examples

Practical examples of SIDJUA governance configuration. Each example shows the YAML, explains what it does in plain English, and describes what happens when an agent violates the rule.

Governance rules live in the `governance/` directory inside your work directory. All files are loaded by `sidjua apply` and enforced by the five-stage pre-action pipeline before every agent action.

---

## How the Five Stages Work

Every agent action passes through these stages in order:

```
Stage 1: Forbidden     → hard block (no exceptions)
Stage 2: Approval      → pause and ask a human
Stage 3: Budget        → block if spending limit exceeded
Stage 4: Classification → block if agent lacks clearance
Stage 5: Policy        → configurable rules (hard or soft)
```

A `BLOCK` at any stage stops the action immediately and writes the reason to the audit trail. A `PAUSE` at stage 2 queues the request for human approval. A `WARN` at stage 5 logs the concern but allows the action to proceed.

---

## Example 1: Basic Safety — Blocking Dangerous File Operations

**Goal:** No agent may delete files without human approval. No agent may ever delete the entire data directory.

**File: `governance/boundaries/forbidden-actions.yaml`**

```yaml
forbidden:
  - action: "data.delete"
    reason: >
      Deleting data records is irreversible. All data deletion requires
      explicit human authorization via the approval workflow.
    escalate_to: SYSTEM_BLOCK

  - action: "file.delete"
    condition: "action.target contains '/app/data'"
    reason: >
      Deleting files inside /app/data is forbidden. This directory contains
      the database, backups, and knowledge collections.
    escalate_to: SYSTEM_BLOCK
```

**What happens when an agent violates this rule:**

The agent's `use_tool` decision (requesting a delete action) is intercepted at Stage 1. The action is blocked with reason "Deleting data records is irreversible...". The governance pipeline writes a `BLOCK` decision to the audit trail, and the agent receives the message: "Tool call was blocked by governance: [reason]. Choose a different approach."

The agent cannot override Stage 1 rules. They fire for all agents at all tiers.

**`escalate_to` values:**
- `SYSTEM_BLOCK` — hard block, no escalation path
- `"division_head"` — human in that role can approve
- `"CEO"` — highest-level human approval required
- An agent ID — specific agent must approve

---

## Example 2: Budget Control — Division Spending Limits

**Goal:** The engineering division may spend at most $200/month and $20/day. Alert the team at 75% utilization.

Budget limits are configured in `.system/cost-centers.yaml`, which is generated and maintained by `sidjua apply`. You control the limits by editing this file and re-running apply.

**File: `.system/cost-centers.yaml`** (managed by `sidjua apply`; edit before re-applying)

```yaml
schema_version: "1.0"
global:
  monthly_limit_usd: null        # no global cap — per-division limits apply
  daily_limit_usd: null
  alert_threshold_percent: 80

divisions:
  engineering:
    monthly_limit_usd: 200.00
    daily_limit_usd: 20.00
  marketing:
    monthly_limit_usd: 100.00
    daily_limit_usd: null        # no daily cap for marketing
  legal:
    monthly_limit_usd: 50.00
    daily_limit_usd: null
```

After editing, sync to the database:

```bash
sidjua apply --step COST_CENTERS
```

**What happens when the limit is approached or reached:**

At 80% (the default alert threshold) of the monthly limit, a `BUDGET_WARNING` event is emitted. The division has spent $160 of its $200 budget. Tasks continue, but the event appears in `sidjua logs`.

When a new task's estimated cost would push spending over $200, Stage 3 (Budget) blocks the action with: "Budget exceeded: engineering division monthly limit ($200.00)." The agent cannot proceed and the task is marked `FAILED` or escalated.

Individual agents also have their own per-task and monthly limits (set in the agent's YAML definition). All four levels — org, division, agent, task — must pass before an LLM call is made.

---

## Example 3: Data Boundaries — Division Isolation

**Goal:** Agents in the marketing division cannot read or write data classified as CONFIDENTIAL or higher.

Classification is configured via two files. The levels file defines the labels and their rank order; the rules file defines agent clearances per tier.

**File: `governance/classification/levels.yaml`**

```yaml
levels:
  - code: PUBLIC
    rank: 0
    description: No restrictions
  - code: INTERNAL
    rank: 1
    description: Internal use only
  - code: CONFIDENTIAL
    rank: 2
    description: Limited distribution
  - code: SECRET
    rank: 3
    description: Need-to-know only
  - code: FYEO
    rank: 4
    description: Principals only
```

**File: `governance/classification/rules.yaml`**

```yaml
agent_clearance:
  tier_1: SECRET
  tier_2: CONFIDENTIAL
  tier_3: INTERNAL

division_overrides:
  legal:
    tier_1: FYEO
    tier_2: SECRET
    tier_3: CONFIDENTIAL
  marketing:
    tier_1: CONFIDENTIAL
    tier_2: INTERNAL
    tier_3: PUBLIC
```

**What this means in practice:**

A T3 marketing agent (`max_classification` inherits `tier_3: PUBLIC` for marketing) cannot touch any data marked INTERNAL or above. A T2 marketing agent cannot touch CONFIDENTIAL data. A T2 legal agent, however, can access SECRET data.

When a marketing agent requests an action on a CONFIDENTIAL file, Stage 4 (Classification) blocks it: "Classification exceeds agent clearance: CONFIDENTIAL > PUBLIC." The block is logged to the audit trail.

**Setting the classification on a task:**

```bash
sidjua run "Analyze Q4 legal contracts" \
  --division legal \
  --classification CONFIDENTIAL
```

---

## Example 4: Escalation Rules — Cost Threshold Approvals

**Goal:** Any single action with an estimated cost over $1 must be approved by the division head. Any action costing over $10 must be approved by the CEO.

**File: `governance/boundaries/approval-workflows.yaml`**

```yaml
workflows:
  - trigger:
      action: "api.call"
      condition: "action.estimated_cost_usd > 1"
    require: division_head
    timeout_hours: 24

  - trigger:
      action: "*"
      condition: "action.estimated_cost_usd > 10"
    require: CEO
    timeout_hours: 8

  - trigger:
      action: "purchase.initiate"
    require: CEO
    timeout_hours: 4

  - trigger:
      action: "code.deploy"
    require: division_head
    timeout_hours: 12
```

**What happens when an approval is triggered:**

The task is paused. A pending approval record is created in the database. The human reviewer sees the request in `sidjua decide` and can approve, deny, or provide guidance for a retry.

```bash
# View pending approvals
sidjua decide

# Approve a request
sidjua decide <id> --action retry --guidance "Approved — proceed with caution"

# Deny a request
sidjua decide <id> --action cancel
```

If the timeout expires before a decision is made, the request is automatically denied and the task fails. The timeout values in the YAML above are in hours.

---

## Example 5: Communication Policy — Logging External API Calls

**Goal:** All external API calls must be logged (soft enforcement — warn but allow). All external `POST` requests must be explicitly approved (hard enforcement — block until approved).

**File: `governance/policies/communication-policy.yaml`**

```yaml
source_file: governance/policies/communication-policy.yaml

rules:
  - id: log-all-api-calls
    description: >
      All outbound API calls must appear in the audit trail.
      This is automatically satisfied by the pipeline — rule validates intent.
    action_types:
      - "api.call"
      - "web.fetch"
    check: "always"
    enforcement: soft

  - id: no-unapproved-web-post
    description: >
      Outbound POST requests (web.post) can exfiltrate data or trigger
      external side effects. Require explicit governance approval.
    action_types:
      - "web.post"
    check: "always"
    enforcement: hard

  - id: no-external-email-without-review
    description: >
      Agents may draft emails but may not send them without a human
      reviewing the draft. Sending is blocked; drafting is allowed.
    action_types:
      - "email.send"
    check: "always"
    enforcement: hard
```

**What happens:**

For `api.call` and `web.fetch`: the action is allowed, but a WARN entry appears in the audit trail with rule ID `log-all-api-calls`.

For `web.post`: the action is blocked at Stage 5 with the rule ID `no-unapproved-web-post`. The agent receives the block reason and must find a different approach (for example, `email.draft` followed by a human review).

For `email.send`: blocked with reason from `no-external-email-without-review`. The agent can use `email.draft` (which is allowed — `email.draft` has a `low` risk level in the action type registry) and mark the task complete with the draft attached.

---

## Example 6: Audit Requirements — Minimum Logging Configuration

**Goal:** All governance decisions, escalations, and task completions must be logged. Log retention is 2 years. Exported logs must include full metadata.

**File: `governance/audit/audit-config.yaml`** (generated on first `sidjua apply`, then never overwritten)

```yaml
schema_version: "1.0"
log_level: standard

events:
  task_start: true
  task_complete: true
  decision: true
  escalation: true          # always true — cannot be disabled
  governance_check: true    # always true — cannot be disabled
  error: true               # always true — cannot be disabled
  approval_request: true    # always true — cannot be disabled
  blocked: true             # always true — cannot be disabled

retention:
  days: 730                 # 2 years
  export_before_delete: true

export:
  formats:
    - json
    - csv
  include_metadata: true
```

**Explanation:**

Four event types — `escalation`, `governance_check`, `error`, and `approval_request` — are always logged regardless of this configuration and cannot be set to `false`. The remaining event types can be enabled or disabled.

Setting `retention.days: 730` keeps two years of audit history. When records approach the retention boundary, they are exported to `governance/audit/reports/` before deletion (in JSON and CSV format if `export_before_delete: true`).

The `log_level` field controls detail:
- `minimal` — only terminal events (complete, failed, blocked)
- `standard` — all events listed above (recommended)
- `verbose` — every reasoning turn and pipeline stage result

**Querying the audit trail:**

```bash
# Recent governance blocks
sidjua logs --type governance --since 2026-03-01

# All events for a specific task and its sub-tasks
sidjua logs --task <task-id>

# All escalations in the last 7 days
sidjua logs --type governance --since $(date -d '7 days ago' +%Y-%m-%d)

# Via REST API
curl -H "Authorization: Bearer $SIDJUA_API_KEY" \
  "http://localhost:3000/api/v1/audit?type=governance&since=2026-03-01"
```

---

## Testing Your Governance Rules

After adding or modifying governance rules, validate them before deploying:

```bash
# Validate policy rule consistency
sidjua policy validate

# Run the built-in governance scenario tests
sidjua policy test

# Apply with dry-run to check for YAML errors
sidjua apply --dry-run --verbose
```

Rules take effect as soon as `sidjua apply` completes — no restart required. The governance configuration is loaded fresh at the start of each pipeline evaluation.
