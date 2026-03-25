# Pre-Action Governance Pipeline — Technical Specification V1

Created: 2026-02-26 19:05 PHT
Author: Opus
Classification: L0:ARCH — Core Product Architecture
Status: DRAFT — Review Required
Related: GOVERNANCE-FILESYSTEM-V3-FINAL.md, SIDJUA-APPLY-TECH-SPEC-V1.md
Target: Sonnet (Dev Lead) — V1 Community (AGPL)

## License Compliance

All components in this spec use only AGPL-compatible dependencies.
No new external dependencies introduced — pipeline operates on YAML config + SQLite.

## Overview

Every agent action passes through the Pre-Action Governance Pipeline BEFORE execution.
This is not optional, not a middleware, not a plugin — it IS the runtime.
An agent that bypasses the pipeline is a bug, not a feature.

The pipeline is synchronous and blocking. The agent waits for the pipeline result
before proceeding. There is no "fire and forget" path.

## Pipeline Flow

```
AgentAction
    │
    ▼
┌─ STAGE 1: FORBIDDEN ──────────────────────────────┐
│  Is this action on the forbidden list?             │
│  YES → BLOCK (immediate, no override possible)     │
│  NO  → continue                                    │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ STAGE 2: APPROVAL ───────────────────────────────┐
│  Does this action require prior approval?          │
│  YES + not approved → PAUSE (queue for approval)   │
│  YES + already approved → continue                 │
│  NO  → continue                                    │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ STAGE 3: BUDGET ─────────────────────────────────┐
│  Will this action exceed budget limits?            │
│  EXCEEDS → PAUSE (budget escalation)               │
│  WARN    → continue + emit warning                 │
│  OK      → continue                                │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ STAGE 4: CLASSIFICATION ─────────────────────────┐
│  Does agent have clearance for data classification?│
│  NO  → BLOCK (classification violation)            │
│  YES → continue                                    │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ STAGE 5: POLICY ─────────────────────────────────┐
│  Does action comply with active policies?          │
│  VIOLATION (hard) → BLOCK                          │
│  VIOLATION (soft) → WARN + continue                │
│  COMPLIANT → continue                              │
└────────────────────────────────────────────────────┘
    │
    ▼
┌─ RESULT ──────────────────────────────────────────┐
│  All stages passed → ALLOW                         │
│  Audit trail entry written (always, even on block) │
└────────────────────────────────────────────────────┘
```

## Core Data Structures

### Action Request (Pipeline Input)

```typescript
interface ActionRequest {
  request_id: string;           // UUID, generated per request
  timestamp: string;            // ISO 8601
  agent_id: string;             // e.g. "sonnet-t2"
  agent_tier: 1 | 2 | 3;
  division_code: string;        // e.g. "engineering"
  action: ActionDescriptor;
  context: ActionContext;
}

interface ActionDescriptor {
  type: string;                 // Canonical action type (see Action Type Registry)
  target: string;               // What is being acted on (file path, URL, entity name)
  description: string;          // Human-readable summary
  estimated_cost_usd?: number;  // If known (e.g. LLM API call)
  data_classification?: string; // Classification of data involved, if known
  parameters?: Record<string, unknown>;  // Action-specific params
}

interface ActionContext {
  task_id?: string;             // Parent task chain reference
  parent_request_id?: string;   // If this action is part of a larger sequence
  division_code: string;        // Agent's home division
  target_division?: string;     // If acting on another division's resources
  session_id: string;           // Current agent session
}
```

### Pipeline Result (Pipeline Output)

```typescript
interface PipelineResult {
  request_id: string;           // Echoed from ActionRequest
  timestamp: string;
  verdict: "ALLOW" | "BLOCK" | "PAUSE";
  stage_results: StageResult[];
  blocking_stage?: string;      // Which stage caused BLOCK/PAUSE (null if ALLOW)
  blocking_reason?: string;     // Human-readable reason
  warnings: Warning[];          // Soft warnings (action still allowed)
  audit_entry_id: number;       // ID of the audit_trail entry created
  approval_id?: number;         // If PAUSE → ID in approval_queue
  resume_token?: string;        // Token to resume after approval granted
}

interface StageResult {
  stage: "forbidden" | "approval" | "budget" | "classification" | "policy";
  verdict: "PASS" | "BLOCK" | "PAUSE" | "WARN";
  duration_ms: number;
  rules_checked: RuleCheckResult[];
}

interface RuleCheckResult {
  rule_id: string;              // e.g. "forbidden.sign_contract"
  rule_source: string;          // File path: "governance/boundaries/forbidden-actions.yaml"
  matched: boolean;
  verdict: "PASS" | "BLOCK" | "PAUSE" | "WARN";
  reason?: string;              // Why it matched (or null if passed)
}

interface Warning {
  stage: string;
  rule_id: string;
  message: string;
  severity: "low" | "medium" | "high";
}
```

## Action Type Registry

Canonical action types that the pipeline recognizes. Extensible via governance config.

```typescript
const ACTION_TYPES = {
  // File operations
  "file.read":           { risk: "low",    default_classification: "INTERNAL" },
  "file.write":          { risk: "low",    default_classification: "INTERNAL" },
  "file.delete":         { risk: "medium", default_classification: "INTERNAL" },

  // Communication
  "email.send":          { risk: "high",   default_classification: "CONFIDENTIAL" },
  "email.draft":         { risk: "low",    default_classification: "INTERNAL" },
  "message.send":        { risk: "medium", default_classification: "INTERNAL" },

  // External
  "api.call":            { risk: "low",    default_classification: "INTERNAL" },
  "web.fetch":           { risk: "low",    default_classification: "PUBLIC" },
  "web.post":            { risk: "high",   default_classification: "CONFIDENTIAL" },

  // Code
  "code.execute":        { risk: "medium", default_classification: "INTERNAL" },
  "code.deploy":         { risk: "high",   default_classification: "CONFIDENTIAL" },
  "git.push":            { risk: "medium", default_classification: "INTERNAL" },
  "git.commit":          { risk: "low",    default_classification: "INTERNAL" },

  // Financial
  "purchase.initiate":   { risk: "critical", default_classification: "CONFIDENTIAL" },
  "invoice.create":      { risk: "high",   default_classification: "CONFIDENTIAL" },

  // Data
  "data.export":         { risk: "high",   default_classification: "CONFIDENTIAL" },
  "data.import":         { risk: "medium", default_classification: "INTERNAL" },
  "data.delete":         { risk: "critical", default_classification: "CONFIDENTIAL" },

  // Agent
  "agent.delegate":      { risk: "medium", default_classification: "INTERNAL" },
  "agent.escalate":      { risk: "low",    default_classification: "INTERNAL" },

  // Contract / Legal
  "contract.sign":       { risk: "critical", default_classification: "SECRET" },
  "contract.draft":      { risk: "medium", default_classification: "CONFIDENTIAL" },

  // Catch-all
  "unknown":             { risk: "high",   default_classification: "CONFIDENTIAL" },
} as const;

type ActionType = keyof typeof ACTION_TYPES;
```

## Pipeline Entry Point

```typescript
/**
 * Main pipeline function. Called by the orchestrator BEFORE every agent action.
 * Synchronous — blocks until verdict is returned.
 * ALWAYS writes an audit trail entry, even on BLOCK.
 */
async function evaluateAction(
  request: ActionRequest,
  governance: GovernanceConfig,
  db: Database
): Promise<PipelineResult> {

  const startTime = Date.now();
  const stageResults: StageResult[] = [];
  const warnings: Warning[] = [];

  // Stage 1: Forbidden
  const s1 = await checkForbidden(request, governance.forbidden);
  stageResults.push(s1);
  if (s1.verdict === "BLOCK") {
    return finalize(request, "BLOCK", stageResults, warnings, "forbidden", s1, db);
  }

  // Stage 2: Approval
  const s2 = await checkApproval(request, governance.approval, db);
  stageResults.push(s2);
  if (s2.verdict === "PAUSE") {
    return finalize(request, "PAUSE", stageResults, warnings, "approval", s2, db);
  }

  // Stage 3: Budget
  const s3 = await checkBudget(request, governance.budgets, db);
  stageResults.push(s3);
  if (s3.verdict === "PAUSE") {
    return finalize(request, "PAUSE", stageResults, warnings, "budget", s3, db);
  }
  if (s3.verdict === "WARN") {
    warnings.push(...extractWarnings(s3, "budget"));
  }

  // Stage 4: Classification
  const s4 = await checkClassification(request, governance.classification);
  stageResults.push(s4);
  if (s4.verdict === "BLOCK") {
    return finalize(request, "BLOCK", stageResults, warnings, "classification", s4, db);
  }

  // Stage 5: Policy
  const s5 = await checkPolicy(request, governance.policies);
  stageResults.push(s5);
  if (s5.verdict === "BLOCK") {
    return finalize(request, "BLOCK", stageResults, warnings, "policy", s5, db);
  }
  if (s5.verdict === "WARN") {
    warnings.push(...extractWarnings(s5, "policy"));
  }

  // All stages passed
  return finalize(request, "ALLOW", stageResults, warnings, null, null, db);
}
```

## Stage 1: Forbidden Actions

Checks against `governance/boundaries/forbidden-actions.yaml`.
Fastest check — simple pattern match. No exceptions, no overrides.

### Config Source

```yaml
# governance/boundaries/forbidden-actions.yaml
forbidden:
  - action: contract.sign
    reason: "Contracts require human signature"
    escalate_to: CEO

  - action: purchase.initiate
    condition: "amount_usd > 0"     # ALL purchases forbidden for agents
    reason: "Financial transactions require human authorization"
    escalate_to: CFO

  - action: data.delete
    condition: "target contains 'audit'"
    reason: "Audit trail is immutable"
    escalate_to: SYSTEM_BLOCK       # Not even CEO can override
```

### Implementation

```typescript
interface ForbiddenRule {
  action: string;               // Action type or glob pattern ("data.*")
  condition?: string;           // Optional condition expression
  reason: string;
  escalate_to: string;          // Role, agent_id, or "SYSTEM_BLOCK"
}

async function checkForbidden(
  request: ActionRequest,
  rules: ForbiddenRule[]
): Promise<StageResult> {

  const start = Date.now();
  const checks: RuleCheckResult[] = [];

  for (const rule of rules) {
    const matches = matchAction(request.action.type, rule.action);
    if (!matches) {
      checks.push({ rule_id: `forbidden.${rule.action}`, rule_source: FORBIDDEN_PATH,
                     matched: false, verdict: "PASS" });
      continue;
    }

    // Action type matches — check condition if present
    if (rule.condition) {
      const conditionMet = evaluateCondition(rule.condition, request);
      if (!conditionMet) {
        checks.push({ rule_id: `forbidden.${rule.action}`, rule_source: FORBIDDEN_PATH,
                       matched: false, verdict: "PASS", reason: "Condition not met" });
        continue;
      }
    }

    // Forbidden match found
    checks.push({
      rule_id: `forbidden.${rule.action}`,
      rule_source: FORBIDDEN_PATH,
      matched: true,
      verdict: "BLOCK",
      reason: rule.reason
    });

    return {
      stage: "forbidden",
      verdict: "BLOCK",
      duration_ms: Date.now() - start,
      rules_checked: checks
    };
  }

  return {
    stage: "forbidden",
    verdict: "PASS",
    duration_ms: Date.now() - start,
    rules_checked: checks
  };
}

/**
 * Match action type against rule pattern.
 * Supports: exact match ("email.send"), glob ("data.*"), all ("*")
 */
function matchAction(actionType: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return actionType.startsWith(prefix + ".");
  }
  return actionType === pattern;
}

/**
 * Evaluate simple condition expressions against request context.
 * V1: Supports basic comparisons only. NOT a full expression language.
 * Examples: "amount_usd > 500", "target contains 'audit'"
 */
function evaluateCondition(condition: string, request: ActionRequest): boolean {
  // V1: Simple tokenizer — no eval(), no arbitrary code execution
  // Parse: field operator value
  // Fields resolve against: request.action.parameters, request.action.target,
  //   request.action.estimated_cost_usd
  // Operators: >, <, >=, <=, ==, !=, contains
  // Returns false on parse error (fail-safe: if can't evaluate, don't block)

  try {
    const parsed = parseCondition(condition);
    const fieldValue = resolveField(parsed.field, request);
    return compareValues(fieldValue, parsed.operator, parsed.value);
  } catch {
    // Fail-safe: unparseable condition does not block
    // But log a warning — the governance config has a bug
    return false;
  }
}
```

## Stage 2: Approval Workflows

Checks against `governance/boundaries/approval-workflows.yaml` and `approval_queue` table.

### Config Source

```yaml
# governance/boundaries/approval-workflows.yaml (V1 — single-stage only)
workflows:
  - trigger:
      action: code.deploy
    require: division_head
    timeout_hours: 24

  - trigger:
      action: email.send
      condition: "target_division != division_code"  # Cross-division email
    require: division_head
    timeout_hours: 4

  - trigger:
      action: "data.export"
    require: division_head
    timeout_hours: 24
```

### Implementation

```typescript
interface ApprovalWorkflow {
  trigger: {
    action: string;             // Action type or glob
    condition?: string;         // Optional condition
  };
  require: string;              // "division_head" | "CEO" | specific agent_id
  timeout_hours: number;
}

async function checkApproval(
  request: ActionRequest,
  workflows: ApprovalWorkflow[],
  db: Database
): Promise<StageResult> {

  const start = Date.now();
  const checks: RuleCheckResult[] = [];

  for (const wf of workflows) {
    const matches = matchAction(request.action.type, wf.trigger.action);
    if (!matches) {
      checks.push({ rule_id: `approval.${wf.trigger.action}`, rule_source: APPROVAL_PATH,
                     matched: false, verdict: "PASS" });
      continue;
    }

    if (wf.trigger.condition && !evaluateCondition(wf.trigger.condition, request)) {
      checks.push({ rule_id: `approval.${wf.trigger.action}`, rule_source: APPROVAL_PATH,
                     matched: false, verdict: "PASS", reason: "Condition not met" });
      continue;
    }

    // Workflow triggered — check if already approved
    const existing = await findApproval(db, request, wf);

    if (existing && existing.status === "approved") {
      checks.push({ rule_id: `approval.${wf.trigger.action}`, rule_source: APPROVAL_PATH,
                     matched: true, verdict: "PASS", reason: "Previously approved" });
      continue;
    }

    if (existing && existing.status === "denied") {
      checks.push({ rule_id: `approval.${wf.trigger.action}`, rule_source: APPROVAL_PATH,
                     matched: true, verdict: "BLOCK", reason: "Approval denied" });
      return { stage: "approval", verdict: "BLOCK", duration_ms: Date.now() - start,
               rules_checked: checks };
    }

    if (existing && existing.status === "pending") {
      checks.push({ rule_id: `approval.${wf.trigger.action}`, rule_source: APPROVAL_PATH,
                     matched: true, verdict: "PAUSE", reason: "Awaiting approval" });
      return { stage: "approval", verdict: "PAUSE", duration_ms: Date.now() - start,
               rules_checked: checks };
    }

    // No existing approval — create request and PAUSE
    const approvalId = await createApprovalRequest(db, request, wf);
    checks.push({ rule_id: `approval.${wf.trigger.action}`, rule_source: APPROVAL_PATH,
                   matched: true, verdict: "PAUSE",
                   reason: `Approval required from ${wf.require}` });

    return { stage: "approval", verdict: "PAUSE", duration_ms: Date.now() - start,
             rules_checked: checks };
  }

  return { stage: "approval", verdict: "PASS", duration_ms: Date.now() - start,
           rules_checked: checks };
}

/**
 * Find existing approval for this specific action.
 * Matches on: agent_id + action_type + target + status in (pending, approved, denied)
 * Approved entries expire after timeout_hours.
 */
async function findApproval(
  db: Database,
  request: ActionRequest,
  workflow: ApprovalWorkflow
): Promise<ApprovalRecord | null> {
  // SELECT from approval_queue WHERE
  //   agent_id = request.agent_id
  //   AND action_description LIKE action_type
  //   AND status IN ('pending', 'approved', 'denied')
  //   AND created_at > datetime('now', '-{timeout_hours} hours')
  // ORDER BY created_at DESC LIMIT 1
  return null; // placeholder
}

/**
 * Insert new approval request into approval_queue.
 * Returns the approval_queue.id for tracking.
 */
async function createApprovalRequest(
  db: Database,
  request: ActionRequest,
  workflow: ApprovalWorkflow
): Promise<number> {
  // INSERT INTO approval_queue (agent_id, division_code, action_description,
  //   rule_triggered, status, metadata)
  // VALUES (request.agent_id, request.division_code,
  //   JSON.stringify(request.action), workflow.trigger.action, 'pending',
  //   JSON.stringify({ workflow, request_id: request.request_id }))
  return 0; // placeholder — return inserted ID
}
```

## Stage 3: Budget Check

Checks estimated cost against `cost_budgets` table and current spend in `cost_ledger`.

### Implementation

```typescript
async function checkBudget(
  request: ActionRequest,
  budgetConfig: BudgetConfig,
  db: Database
): Promise<StageResult> {

  const start = Date.now();
  const checks: RuleCheckResult[] = [];

  // No cost estimate — pass (can't check what we don't know)
  if (!request.action.estimated_cost_usd || request.action.estimated_cost_usd === 0) {
    checks.push({ rule_id: "budget.no_estimate", rule_source: "system",
                   matched: false, verdict: "PASS", reason: "No cost estimate" });
    return { stage: "budget", verdict: "PASS", duration_ms: Date.now() - start,
             rules_checked: checks };
  }

  const cost = request.action.estimated_cost_usd;
  const division = request.context.division_code;

  // Load current spend
  const dailySpend = await getDailySpend(db, division);
  const monthlySpend = await getMonthlySpend(db, division);

  // Load budget limits
  const budget = await getBudget(db, division);
  if (!budget) {
    checks.push({ rule_id: "budget.no_limit", rule_source: COST_CENTERS_PATH,
                   matched: false, verdict: "PASS", reason: "No budget configured" });
    return { stage: "budget", verdict: "PASS", duration_ms: Date.now() - start,
             rules_checked: checks };
  }

  // Check daily limit
  if (budget.daily_limit_usd !== null) {
    const projectedDaily = dailySpend + cost;
    if (projectedDaily > budget.daily_limit_usd) {
      checks.push({ rule_id: "budget.daily_exceeded", rule_source: COST_CENTERS_PATH,
                     matched: true, verdict: "PAUSE",
                     reason: `Daily budget exceeded: ${projectedDaily.toFixed(2)} > ${budget.daily_limit_usd}` });
      return { stage: "budget", verdict: "PAUSE", duration_ms: Date.now() - start,
               rules_checked: checks };
    }
    const pct = (projectedDaily / budget.daily_limit_usd) * 100;
    if (pct >= budget.alert_threshold_percent) {
      checks.push({ rule_id: "budget.daily_warn", rule_source: COST_CENTERS_PATH,
                     matched: true, verdict: "WARN",
                     reason: `Daily budget at ${pct.toFixed(0)}%` });
    }
  }

  // Check monthly limit
  if (budget.monthly_limit_usd !== null) {
    const projectedMonthly = monthlySpend + cost;
    if (projectedMonthly > budget.monthly_limit_usd) {
      checks.push({ rule_id: "budget.monthly_exceeded", rule_source: COST_CENTERS_PATH,
                     matched: true, verdict: "PAUSE",
                     reason: `Monthly budget exceeded: ${projectedMonthly.toFixed(2)} > ${budget.monthly_limit_usd}` });
      return { stage: "budget", verdict: "PAUSE", duration_ms: Date.now() - start,
               rules_checked: checks };
    }
    const pct = (projectedMonthly / budget.monthly_limit_usd) * 100;
    if (pct >= budget.alert_threshold_percent) {
      checks.push({ rule_id: "budget.monthly_warn", rule_source: COST_CENTERS_PATH,
                     matched: true, verdict: "WARN",
                     reason: `Monthly budget at ${pct.toFixed(0)}%` });
    }
  }

  // Determine final verdict for this stage
  const hasWarn = checks.some(c => c.verdict === "WARN");
  return {
    stage: "budget",
    verdict: hasWarn ? "WARN" : "PASS",
    duration_ms: Date.now() - start,
    rules_checked: checks
  };
}

async function getDailySpend(db: Database, division: string): Promise<number> {
  // SELECT COALESCE(SUM(cost_usd), 0) FROM cost_ledger
  // WHERE division_code = ? AND date(timestamp) = date('now')
  return 0;
}

async function getMonthlySpend(db: Database, division: string): Promise<number> {
  // SELECT COALESCE(SUM(cost_usd), 0) FROM cost_ledger
  // WHERE division_code = ? AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
  return 0;
}
```

## Stage 4: Classification Check

Checks agent's clearance level against data classification of the action's target.

### Config Source

```yaml
# governance/classification/levels.yaml
levels:
  - code: PUBLIC
    rank: 0
    description: "No restrictions"
  - code: INTERNAL
    rank: 1
    description: "Company employees/agents only"
  - code: CONFIDENTIAL
    rank: 2
    description: "Need-to-know basis"
  - code: SECRET
    rank: 3
    description: "Named individuals only"
  - code: FYEO
    rank: 4
    description: "For Your Eyes Only — human only"

# governance/classification/rules.yaml
agent_clearance:
  tier_1: SECRET       # T1 agents can access up to SECRET
  tier_2: CONFIDENTIAL # T2 agents can access up to CONFIDENTIAL
  tier_3: INTERNAL     # T3 agents can access up to INTERNAL

# Override per division (optional)
division_overrides:
  legal:
    tier_2: SECRET     # Legal division T2 agents need higher clearance
```

### Implementation

```typescript
interface ClassificationConfig {
  levels: ClassificationLevel[];
  agent_clearance: Record<string, string>;       // "tier_1" → "SECRET"
  division_overrides?: Record<string, Record<string, string>>;
}

interface ClassificationLevel {
  code: string;
  rank: number;
  description: string;
}

async function checkClassification(
  request: ActionRequest,
  config: ClassificationConfig
): Promise<StageResult> {

  const start = Date.now();
  const checks: RuleCheckResult[] = [];

  // Determine data classification of the action
  const dataClass = resolveClassification(request, config);

  // FYEO always blocks agents — human only
  if (dataClass === "FYEO") {
    checks.push({ rule_id: "classification.fyeo", rule_source: CLASSIFICATION_PATH,
                   matched: true, verdict: "BLOCK",
                   reason: "FYEO data requires human access" });
    return { stage: "classification", verdict: "BLOCK", duration_ms: Date.now() - start,
             rules_checked: checks };
  }

  // Determine agent clearance
  const tierKey = `tier_${request.agent_tier}`;
  let clearance: string;

  // Check division override first
  if (config.division_overrides?.[request.division_code]?.[tierKey]) {
    clearance = config.division_overrides[request.division_code][tierKey];
  } else {
    clearance = config.agent_clearance[tierKey] || "PUBLIC";
  }

  const dataRank = getRank(dataClass, config.levels);
  const clearanceRank = getRank(clearance, config.levels);

  if (dataRank > clearanceRank) {
    checks.push({ rule_id: "classification.insufficient_clearance",
                   rule_source: CLASSIFICATION_PATH, matched: true, verdict: "BLOCK",
                   reason: `Agent tier ${request.agent_tier} (clearance: ${clearance}) cannot access ${dataClass} data` });
    return { stage: "classification", verdict: "BLOCK", duration_ms: Date.now() - start,
             rules_checked: checks };
  }

  checks.push({ rule_id: "classification.check", rule_source: CLASSIFICATION_PATH,
                 matched: false, verdict: "PASS" });
  return { stage: "classification", verdict: "PASS", duration_ms: Date.now() - start,
           rules_checked: checks };
}

/**
 * Resolve classification of data involved in the action.
 * Priority: explicit in request > file metadata > action type default
 */
function resolveClassification(request: ActionRequest, config: ClassificationConfig): string {
  // 1. Explicitly set in action descriptor
  if (request.action.data_classification) return request.action.data_classification;

  // 2. Cross-division access → auto-elevate to CONFIDENTIAL minimum
  if (request.context.target_division &&
      request.context.target_division !== request.context.division_code) {
    return "CONFIDENTIAL";
  }

  // 3. Default from action type registry
  const actionDef = ACTION_TYPES[request.action.type as ActionType];
  if (actionDef) return actionDef.default_classification;

  // 4. Unknown action → CONFIDENTIAL (fail-safe: restrict unknown)
  return "CONFIDENTIAL";
}

function getRank(code: string, levels: ClassificationLevel[]): number {
  const level = levels.find(l => l.code === code);
  return level?.rank ?? 99;  // Unknown classification → highest rank (most restricted)
}
```

## Stage 5: Policy Check

Checks against all active policies in `governance/policies/`.
Most flexible stage — supports custom policy YAML.

### Config Source

```yaml
# governance/policies/ethics.yaml
rules:
  - id: no_deception
    description: "Agents must not create deceptive content"
    action_types: ["email.send", "message.send", "web.post"]
    check: "parameters.intent != 'deceptive'"
    enforcement: hard    # hard = BLOCK, soft = WARN

  - id: human_oversight
    description: "Critical decisions require human notification"
    action_types: ["contract.*", "purchase.*", "data.delete"]
    check: "always"      # Always triggers for these action types
    enforcement: hard

# governance/policies/data-handling.yaml
rules:
  - id: no_pii_export
    description: "No PII in external communications"
    action_types: ["email.send", "web.post", "data.export"]
    check: "parameters.contains_pii != true"
    enforcement: hard

  - id: log_external_access
    description: "Log all external data access"
    action_types: ["web.fetch", "api.call"]
    check: "always"
    enforcement: soft    # Warn only, don't block
```

### Implementation

```typescript
interface PolicyRule {
  id: string;
  description: string;
  action_types: string[];       // Action types or globs this rule applies to
  check: string;                // Condition expression or "always"
  enforcement: "hard" | "soft"; // hard = BLOCK, soft = WARN
}

interface PolicyConfig {
  source_file: string;          // Which YAML file this came from
  rules: PolicyRule[];
}

async function checkPolicy(
  request: ActionRequest,
  policies: PolicyConfig[]
): Promise<StageResult> {

  const start = Date.now();
  const checks: RuleCheckResult[] = [];
  let worstVerdict: "PASS" | "WARN" | "BLOCK" = "PASS";

  for (const policy of policies) {
    for (const rule of policy.rules) {
      // Check if rule applies to this action type
      const applies = rule.action_types.some(pat => matchAction(request.action.type, pat));
      if (!applies) continue;

      // Evaluate the check
      let violated = false;
      if (rule.check === "always") {
        violated = true;  // "always" means this rule always triggers
      } else {
        // Evaluate condition — violation = condition is FALSE
        violated = !evaluateCondition(rule.check, request);
      }

      if (violated) {
        const verdict = rule.enforcement === "hard" ? "BLOCK" : "WARN";
        checks.push({
          rule_id: `policy.${rule.id}`,
          rule_source: policy.source_file,
          matched: true,
          verdict,
          reason: rule.description
        });

        if (verdict === "BLOCK") worstVerdict = "BLOCK";
        else if (verdict === "WARN" && worstVerdict !== "BLOCK") worstVerdict = "WARN";

        // Short-circuit on first BLOCK
        if (worstVerdict === "BLOCK") {
          return { stage: "policy", verdict: "BLOCK", duration_ms: Date.now() - start,
                   rules_checked: checks };
        }
      } else {
        checks.push({
          rule_id: `policy.${rule.id}`,
          rule_source: policy.source_file,
          matched: false,
          verdict: "PASS"
        });
      }
    }
  }

  return { stage: "policy", verdict: worstVerdict, duration_ms: Date.now() - start,
           rules_checked: checks };
}
```

## Finalization & Audit Trail

Every pipeline execution writes an audit trail entry — ALLOW, BLOCK, and PAUSE alike.

```typescript
async function finalize(
  request: ActionRequest,
  verdict: "ALLOW" | "BLOCK" | "PAUSE",
  stageResults: StageResult[],
  warnings: Warning[],
  blockingStage: string | null,
  blockingResult: StageResult | null,
  db: Database
): Promise<PipelineResult> {

  const blockingReason = blockingResult
    ? blockingResult.rules_checked.find(r => r.matched)?.reason || "Unknown"
    : null;

  // Write audit trail entry
  const auditId = await writeAuditEntry(db, {
    agent_id: request.agent_id,
    division_code: request.division_code,
    action_type: "governance_check",
    action_detail: `${verdict}: ${request.action.type} on ${request.action.target}`,
    governance_check: JSON.stringify(stageResults),
    input_summary: truncate(JSON.stringify(request.action), 500),
    output_summary: blockingReason || "Allowed",
    token_count: null,
    cost_usd: null,
    classification: request.action.data_classification || "INTERNAL",
    parent_task_id: request.context.task_id || null,
    metadata: JSON.stringify({ warnings, verdict, blocking_stage: blockingStage })
  });

  // If PAUSE — create or find approval_queue entry
  let approvalId: number | undefined;
  let resumeToken: string | undefined;
  if (verdict === "PAUSE") {
    approvalId = await getOrCreateApprovalId(db, request);
    resumeToken = generateResumeToken(request.request_id, approvalId);
  }

  return {
    request_id: request.request_id,
    timestamp: new Date().toISOString(),
    verdict,
    stage_results: stageResults,
    blocking_stage: blockingStage || undefined,
    blocking_reason: blockingReason || undefined,
    warnings,
    audit_entry_id: auditId,
    approval_id: approvalId,
    resume_token: resumeToken
  };
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) + "..." : str;
}

function generateResumeToken(requestId: string, approvalId: number): string {
  // HMAC-SHA256(requestId + approvalId, system_secret)
  // Agent presents this token after approval to resume the action
  return "";  // placeholder
}
```

## Resume After Approval

When an action is PAUSED for approval, the agent receives a `resume_token`.
After a human (or authorized agent) approves, the original action can be retried.

```typescript
/**
 * Called when agent retries a PAUSED action after approval.
 * Verifies the resume_token and re-runs the full pipeline.
 * The approval stage will find the "approved" entry and pass.
 */
async function resumeAction(
  request: ActionRequest,
  resumeToken: string,
  governance: GovernanceConfig,
  db: Database
): Promise<PipelineResult> {

  // 1. Validate resume token
  const valid = validateResumeToken(resumeToken, request.request_id);
  if (!valid) {
    throw new GovernanceError("INVALID_RESUME_TOKEN", "Resume token invalid or expired");
  }

  // 2. Re-run full pipeline (approval stage will find approved entry)
  return evaluateAction(request, governance, db);
}

/**
 * Called by human or authorized agent to approve/deny a pending request.
 */
async function resolveApproval(
  db: Database,
  approvalId: number,
  decision: "approved" | "denied",
  decidedBy: string           // agent_id or "human"
): Promise<void> {

  await db.run(
    `UPDATE approval_queue
     SET status = ?, decided_by = ?, decided_at = datetime('now')
     WHERE id = ? AND status = 'pending'`,
    [decision, decidedBy, approvalId]
  );

  // Write audit entry for the approval decision itself
  const approval = await db.get(`SELECT * FROM approval_queue WHERE id = ?`, [approvalId]);
  await writeAuditEntry(db, {
    agent_id: decidedBy,
    division_code: approval.division_code,
    action_type: decision === "approved" ? "approval_granted" : "blocked",
    action_detail: `${decision} request #${approvalId}: ${approval.action_description}`,
    governance_check: null,
    input_summary: null,
    output_summary: decision,
    classification: "INTERNAL",
    parent_task_id: null,
    metadata: JSON.stringify({ approval_id: approvalId })
  });
}
```

## Governance Config Loader

Loads and caches all governance YAML files into a single config object.

```typescript
interface GovernanceConfig {
  forbidden: ForbiddenRule[];
  approval: ApprovalWorkflow[];
  budgets: BudgetConfig;
  classification: ClassificationConfig;
  policies: PolicyConfig[];
  loaded_at: string;
  file_hashes: Record<string, string>;  // For change detection
}

/**
 * Load all governance config from filesystem.
 * Called at startup and when config files change (file watcher).
 * Validates all YAML before applying — invalid config = keep previous.
 */
async function loadGovernanceConfig(basePath: string): Promise<GovernanceConfig> {
  const config: GovernanceConfig = {
    forbidden: loadYaml(`${basePath}/boundaries/forbidden-actions.yaml`)?.forbidden || [],
    approval: loadYaml(`${basePath}/boundaries/approval-workflows.yaml`)?.workflows || [],
    budgets: loadYaml(`${basePath}/boundaries/spending-limits.yaml`) || {},
    classification: {
      levels: loadYaml(`${basePath}/classification/levels.yaml`)?.levels || DEFAULT_LEVELS,
      agent_clearance: loadYaml(`${basePath}/classification/rules.yaml`)?.agent_clearance || DEFAULT_CLEARANCE,
      division_overrides: loadYaml(`${basePath}/classification/rules.yaml`)?.division_overrides,
    },
    policies: loadAllPolicies(`${basePath}/policies/`),
    loaded_at: new Date().toISOString(),
    file_hashes: {}
  };

  validateGovernanceConfig(config);  // Throws on invalid config
  return config;
}

/**
 * Load all *.yaml files from policies/ directory.
 * Each file becomes a PolicyConfig with its rules.
 */
function loadAllPolicies(policiesDir: string): PolicyConfig[] {
  const files = listYamlFiles(policiesDir);  // Recursive, including custom/
  return files.map(f => ({
    source_file: f,
    rules: loadYaml(f)?.rules || []
  }));
}
```

## Error Handling

```typescript
class GovernanceError extends Error {
  constructor(
    public code: string,
    message: string,
    public stage?: string,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}

// Error codes
const GOVERNANCE_ERRORS = {
  CONFIG_LOAD_FAILED: "Failed to load governance configuration",
  CONFIG_INVALID: "Governance configuration validation failed",
  INVALID_ACTION_TYPE: "Unknown action type with no fallback",
  INVALID_RESUME_TOKEN: "Resume token invalid or expired",
  APPROVAL_NOT_FOUND: "Approval entry not found",
  DB_ERROR: "Database operation failed",
  CONDITION_PARSE_ERROR: "Failed to parse condition expression",
} as const;
```

**Design principle:** Pipeline errors BLOCK the action (fail-closed).
If the governance system itself fails, the agent cannot proceed.
This is intentional — a broken governance check is worse than a delayed action.

Exception: Condition parse errors in `evaluateCondition` fail OPEN within
their stage (don't block on unparseable conditions) but log a warning.
The config author is notified of the parse error so they can fix it.

## Personal Mode Differences

In personal mode (`mode: personal` in divisions.yaml):

- Forbidden actions: Loaded from `governance/my-rules.yaml` (enforcement: "block")
- Approval workflows: Loaded from `governance/my-rules.yaml` (enforcement: "ask_first")
- Budget: Global only, no per-division
- Classification: Simplified — only PUBLIC and PRIVATE (no CONFIDENTIAL/SECRET/FYEO)
- Policies: Loaded from `governance/my-rules.yaml`

The pipeline itself is identical. Only the config sources and defaults differ.

```typescript
function loadPersonalGovernanceConfig(basePath: string): GovernanceConfig {
  const myRules = loadYaml(`${basePath}/my-rules.yaml`);

  return {
    forbidden: myRules?.my_rules
      ?.filter((r: any) => r.enforce === "block")
      .map(ruleToForbidden) || [],
    approval: myRules?.my_rules
      ?.filter((r: any) => r.enforce === "ask_first")
      .map(ruleToApproval) || [],
    budgets: extractBudgetRules(myRules) || {},
    classification: PERSONAL_CLASSIFICATION_DEFAULTS,
    policies: [],  // Personal mode has no separate policy files by default
    loaded_at: new Date().toISOString(),
    file_hashes: {}
  };
}
```

## Performance Requirements

- Full pipeline execution: < 50ms for typical config (< 100 rules total)
- Stage 1 (Forbidden): < 5ms (simple pattern matching)
- Stage 2 (Approval): < 10ms (single DB query)
- Stage 3 (Budget): < 10ms (two DB queries)
- Stage 4 (Classification): < 5ms (lookup only)
- Stage 5 (Policy): < 20ms (condition evaluation)
- Governance config reload: < 200ms

## Testing Checklist

- [ ] Forbidden action correctly blocked (exact match)
- [ ] Forbidden action with glob pattern ("data.*")
- [ ] Forbidden action with condition (amount > threshold)
- [ ] Approval workflow triggers PAUSE for new action
- [ ] Approval workflow passes for previously approved action
- [ ] Approved action can resume with valid token
- [ ] Denied action stays blocked on retry
- [ ] Expired approval treated as new request
- [ ] Budget PAUSE when daily limit exceeded
- [ ] Budget WARN at threshold percent
- [ ] Budget passes when no limit configured
- [ ] Classification blocks T3 agent from CONFIDENTIAL data
- [ ] Classification allows T1 agent for SECRET data
- [ ] FYEO always blocks all agents
- [ ] Cross-division access auto-elevates to CONFIDENTIAL
- [ ] Hard policy violation → BLOCK
- [ ] Soft policy violation → WARN + continue
- [ ] Audit trail written for ALLOW, BLOCK, and PAUSE
- [ ] Audit entry contains full governance check JSON
- [ ] Pipeline fails closed on config load error
- [ ] Pipeline fails closed on DB error
- [ ] Condition parse error → fail open with warning
- [ ] Personal mode loads from my-rules.yaml
- [ ] All 5 stages execute in order (no stage skipped)
- [ ] Performance: < 50ms for 100-rule config
