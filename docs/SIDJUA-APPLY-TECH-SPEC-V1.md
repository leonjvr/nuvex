# `sidjua apply` — Technical Specification V1

Created: 2026-02-26 18:25 PHT
Author: Opus
Classification: L0:ARCH — Core Product Architecture
Status: DRAFT — Review Required
Related: GOVERNANCE-FILESYSTEM-V3-FINAL.md, V3.1-AMENDMENT.md
Target: Sonnet (Dev Lead) — V1 Community (AGPL)

## License Compliance Rule

**EVERY dependency must be license-audited BEFORE architectural adoption.**
No component enters the spec without confirmed license compatibility.

V1 (AGPL-3.0-only): Only AGPL-compatible licenses allowed.
Accepted: MIT, BSD-2/3-Clause, Apache-2.0, ISC, Unlicense, CC0, LGPL-2.1+, LGPL-3.0+, GPL-3.0+, AGPL-3.0
Problematic: MPL-2.0 with Exhibit B, SSPL, BSL, CPAL, OSL-3.0, any "Incompatible With Secondary Licenses"
Forbidden: Proprietary, BUSL, custom restrictive licenses

V2 (Commercial): Broader compatibility, but still must respect upstream licenses.
MPL-2.0 (even with Exhibit B) OK for separate services under commercial license — pending legal confirmation.

Audit log: #290 License Audit (ongoing, due 01.04.2026)

| Component | License | AGPL-compatible | Audited | Notes |
|-----------|---------|-----------------|---------|-------|
| SQLite | Public Domain | ✅ | 2026-02-23 | #290 |
| SQLCipher | BSD-3-Clause | ✅ | 2026-02-26 | Sealed Store |
| OpenBao | MPL-2.0 + Exhibit B | ⚠️ V2 only | 2026-02-26 | Separate service, legal review pending |
| Infisical | MIT (core), proprietary (ee/) | ✅ (core) | 2026-02-26 | V2 Enterprise PRIMARY candidate |
| CyberArk Conjur OSS | LGPL-3.0 | ✅ | 2026-02-26 | V2 Enterprise Plan C (CyberArk-compat) |
| Argon2 | CC0 / Apache-2.0 | ✅ | 2026-02-26 | KDF for SQLCipher passphrase |

This table MUST be updated for every new dependency added to the spec.

## Overview

`sidjua apply` reads `divisions.yaml` and provisions 8 subsystems in a deterministic order. It is **idempotent** — running it multiple times produces the same result. It is the ONLY entry point for structural changes. No subsystem provisions itself.

## Input

**Primary:** `divisions.yaml` (Single Source of Truth)
**Secondary:** `governance/*.yaml` (policies, boundaries, classification — read but not provisioned by apply)

## Execution Order

Strict sequential — each step depends on previous steps succeeding.

```
1. VALIDATE     → Parse + validate divisions.yaml
2. FILESYSTEM   → Create directory structure
3. DATABASE     → Create/migrate tables
4. SECRETS      → Provision secrets paths
5. RBAC         → Generate role assignments
6. ROUTING      → Build agent routing table
7. SKILLS       → Assign skill directories
8. AUDIT        → Initialize audit partitions
9. COST_CENTERS → Set up budget tracking
10. FINALIZE    → Write state file + README
```

## Step 1: VALIDATE

### Input
- `divisions.yaml` path (default: `./divisions.yaml`)

### Validation Rules

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];    // Fatal — abort
  warnings: ValidationWarning[]; // Non-fatal — log + continue
}

interface ValidationError {
  field: string;      // e.g. "divisions[3].code"
  rule: string;       // e.g. "UNIQUE_CODE"
  message: string;
}
```

**Fatal Errors (abort):**
- `schema_version` missing or unsupported
- `company.name` missing
- `company.size` not in size_presets keys or "personal"
- `mode` present but not "personal" | "business"
- Division `code` not unique
- Division `code` contains characters outside `[a-z0-9-]`
- Division `code` length > 32
- Required division missing when `active: true`
- Circular `head.agent` references (same agent heads conflicting divisions)

**Warnings (continue):**
- Division in `size_presets[current_size].recommended` but `active: false`
- `head.agent` references unknown agent ID (agent may not exist yet)
- Locale not in supported list (fallback to "en")
- Custom division without `scope` field

### Schema Versioning

```typescript
const SUPPORTED_SCHEMA_VERSIONS = ["1.0"];

// Future: migration functions
const MIGRATIONS: Record<string, (yaml: any) => any> = {
  // "0.9_to_1.0": (yaml) => { ... }
};
```

### Missing Field Defaults

```typescript
const DIVISION_DEFAULTS = {
  active: false,
  required: false,
  recommend_from: null,
  head: { role: null, agent: null },
  scope: ""
};

const COMPANY_DEFAULTS = {
  locale: "en",
  timezone: "UTC",
  size: "solo",
  mode: "business"   // Default if mode field absent
};
```

## Step 2: FILESYSTEM

### Business Mode

For each division where `active: true`, create:

```
/{division.code}/
├── inbox/           # Incoming tasks for this division
├── outbox/          # Completed deliverables
├── workspace/       # Working area (drafts, WIP)
├── knowledge/       # Division-specific knowledge base
├── archive/         # Completed/historical items
└── .meta/
    └── division.json  # Division metadata (from divisions.yaml)
```

**Also create (always):**

```
/governance/         # (structure from V3-FINAL — not created by apply,
                     #  only verified to exist. User/templates populate.)
/.system/
├── state.json       # Apply state (version, last run, checksums)
├── routing-table.yaml
├── rbac.yaml
├── cost-centers.yaml
└── scan-protocol.md  # Copy from templates

/archive/
/README.md            # Auto-generated navigation
```

### Personal Mode

```
/workspace/
├── projects/        # User creates project subdirs
├── knowledge/
└── templates/

/governance/
├── my-rules.yaml    # Generated from template if not exists
└── boundaries/
    └── forbidden-actions.yaml  # Generated from template

/ai-governance/
├── agents/
├── skills/
└── audit-trail/

/.system/
├── state.json
├── routing-table.yaml
├── rbac.yaml
└── cost-centers.yaml

/archive/
/README.md
```

### Filesystem Operations

```typescript
interface FilesystemOp {
  type: "mkdir" | "write" | "copy_template" | "skip_existing";
  path: string;
  content?: string;        // For write
  template?: string;       // For copy_template
  overwrite: boolean;      // false = skip if exists
}

// sidjua apply generates a list of FilesystemOps, then executes them.
// This enables dry-run mode: generate ops, print them, don't execute.

function planFilesystem(config: ParsedConfig): FilesystemOp[] {
  const ops: FilesystemOp[] = [];

  if (config.mode === "personal") {
    ops.push({ type: "mkdir", path: "/workspace/projects", overwrite: false });
    ops.push({ type: "mkdir", path: "/workspace/knowledge", overwrite: false });
    ops.push({ type: "mkdir", path: "/workspace/templates", overwrite: false });
    // ... personal structure
  } else {
    for (const div of config.activeDivisions) {
      for (const subdir of ["inbox", "outbox", "workspace", "knowledge", "archive", ".meta"]) {
        ops.push({ type: "mkdir", path: `/${div.code}/${subdir}`, overwrite: false });
      }
      ops.push({
        type: "write",
        path: `/${div.code}/.meta/division.json`,
        content: JSON.stringify(divisionMeta(div), null, 2),
        overwrite: true  // Always update metadata
      });
    }
  }

  // System dirs (always)
  ops.push({ type: "mkdir", path: "/.system", overwrite: false });
  ops.push({ type: "mkdir", path: "/archive", overwrite: false });

  return ops;
}
```

### Idempotency Rules
- `mkdir` with `overwrite: false` → skip if exists (no error)
- `write` with `overwrite: false` → skip if exists
- `write` with `overwrite: true` → always write (metadata, generated files)
- Never delete directories on re-apply (deactivated divisions keep their data)
- Deactivated divisions: directory stays, but routing/RBAC/cost entries removed

## Step 3: DATABASE

### Technology
- V1: SQLite (single-file, zero config, Docker-friendly)
- V2: D1/PostgreSQL upgrade path

### Tables

```sql
-- Core tables created by sidjua apply

-- Division registry (mirrors divisions.yaml in queryable form)
CREATE TABLE IF NOT EXISTS divisions (
  code TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_localized TEXT,
  scope TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0,
  head_role TEXT,
  head_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit trail (V1 — readable, exportable, NOT tamper-proof)
CREATE TABLE IF NOT EXISTS audit_trail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  agent_id TEXT NOT NULL,
  division_code TEXT,
  action_type TEXT NOT NULL,        -- 'task_start' | 'task_complete' | 'decision' |
                                    -- 'escalation' | 'governance_check' | 'error' |
                                    -- 'approval_request' | 'approval_granted' | 'blocked'
  action_detail TEXT NOT NULL,       -- Human-readable description
  governance_check BLOB,             -- JSON: which rules were checked, pass/fail
  input_summary TEXT,                -- What the agent received (truncated)
  output_summary TEXT,               -- What the agent produced (truncated)
  token_count INTEGER,               -- Tokens consumed
  cost_usd REAL,                     -- Cost in USD
  classification TEXT DEFAULT 'INTERNAL',
  parent_task_id TEXT,               -- For task chains
  metadata BLOB                      -- JSON: additional context
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_trail(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_division ON audit_trail(division_code);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_trail(action_type);

-- Cost tracking
CREATE TABLE IF NOT EXISTS cost_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  division_code TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,            -- 'anthropic' | 'openai' | 'google' | etc.
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  task_id TEXT,
  FOREIGN KEY (division_code) REFERENCES divisions(code)
);

CREATE INDEX IF NOT EXISTS idx_cost_division ON cost_ledger(division_code);
CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_ledger(timestamp);

-- Cost budgets
CREATE TABLE IF NOT EXISTS cost_budgets (
  division_code TEXT PRIMARY KEY,
  monthly_limit_usd REAL,
  daily_limit_usd REAL,
  alert_threshold_percent REAL DEFAULT 80.0,
  FOREIGN KEY (division_code) REFERENCES divisions(code)
);

-- Governance state (approval queue)
CREATE TABLE IF NOT EXISTS approval_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  agent_id TEXT NOT NULL,
  division_code TEXT,
  action_description TEXT NOT NULL,
  rule_triggered TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'denied' | 'expired'
  decided_by TEXT,
  decided_at TEXT,
  metadata BLOB
);

CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_queue(status);

-- Agent registry
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,               -- e.g. 'opus-t1', 'sonnet-t2'
  name TEXT NOT NULL,
  tier INTEGER NOT NULL,             -- 1, 2, 3
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  division_code TEXT,                -- Primary division assignment
  active INTEGER NOT NULL DEFAULT 1,
  capabilities BLOB,                 -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (division_code) REFERENCES divisions(code)
);

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration Strategy

```typescript
interface Migration {
  version: string;
  up: string;              // SQL to apply
  down: string;            // SQL to rollback
  description: string;
}

// sidjua apply checks /.system/state.json for last applied DB version
// and runs any pending migrations in order.
```

### Database Operations in Apply

```typescript
function applyDatabase(config: ParsedConfig, dbPath: string): void {
  // 1. Create/open SQLite file
  const db = openOrCreate(dbPath);  // default: /.system/sidjua.db

  // 2. Run migrations (creates tables if needed)
  runPendingMigrations(db);

  // 3. Sync divisions table with divisions.yaml
  syncDivisions(db, config.divisions);
  // INSERT OR REPLACE for active divisions
  // SET active=0 for divisions in DB but not in YAML
  // NEVER DELETE rows (historical audit references need them)

  // 4. Initialize cost_budgets for new divisions
  for (const div of config.activeDivisions) {
    ensureBudgetRow(db, div.code);  // INSERT OR IGNORE
  }
}
```

## Step 4: SECRETS

### Architecture: Three Tiers

Secrets management scales with deployment size. The CLI interface (`sidjua secrets set/get/list`)
remains identical across all tiers — only the backend changes.

**V1 All Sizes — "Sealed Store" (SQLCipher)**
- SQLCipher (BSD-3-Clause — AGPL-compatible, license audit: 2026-02-26)
- AES-256 encrypted SQLite database: `/.system/secrets.db`
- Passphrase-derived key (Argon2id KDF)
- Namespace isolation per division (row-level)
- Access logging to audit_trail (who read which secret, when)
- Query-capable: "show secrets older than 90 days"
- Rotation reminders (warn only, no enforcement)
- Unlocked at `sidjua start`, locked at shutdown
- Zero-dependency, single-process, Docker-friendly

**V2 Enterprise Option A — Infisical (PRIMARY)**
- MIT License (core) → fully AGPL-compatible, zero license risk
- 12,700+ GitHub Stars, very active community
- Dynamic secrets, automatic rotation, PKI/certificate management
- Secret scanning and leak prevention (140+ secret types)
- Self-hosted (Docker Compose) + Cloud option
- SDKs: Node, Python, Go, Ruby, Java, .NET
- Audit logs, RBAC, approval workflows, temporary access
- Enterprise features (ee/ directory) under Infisical license
- Strength: Best DX, modern API, fastest growing in category
- Weakness: Younger than Vault ecosystem, less migration tooling

**V2 Enterprise Option B — OpenBao Cluster**
- OpenBao HA-Cluster (multi-node, Shamir unseal)
- HSM backend optional (PKCS#11)
- Automatic key rotation with policy enforcement
- Tamper-proof access audit (signed)
- Dynamic secrets (short-lived DB credentials, cloud tokens)
- Transit encryption (encrypt/decrypt as service)
- Geo-fencing (secrets only in specific regions)
- Vault-compatible API (migration path for existing Vault users)
- LICENSE: MPL-2.0 with Exhibit B "Incompatible With Secondary Licenses"
  → ⚠️ NOT directly AGPL-compatible for code inclusion
  → V2 runs under commercial license, OpenBao as separate service (API only)
  → LEGAL REVIEW REQUIRED: See license-action-items below
- Use case: "Bring Your Own Vault" for customers with existing Vault infra

**V2 Enterprise Option C — CyberArk Conjur OSS**
- LGPL-3.0 → AGPL-compatible (FSF confirmed)
- Enterprise-grade MAML policy language, fine-grained RBAC
- Kubernetes/OpenShift native, Secretless Broker
- Cryptographic audit passed (Slosilo library)
- Weakness: ~700 GitHub Stars, complex setup, poor DX
- Weakness: Advanced features (LDAP/SAML, FIPS) only in CyberArk Enterprise (proprietary)
- Use case: Customers requiring CyberArk ecosystem compatibility

**Excluded:**
- Doppler, Akeyless, AWS Secrets Manager — proprietary/SaaS-only, no self-host
- Mozilla SOPS — file encryption only, not a secrets manager
- HashiCorp Vault — BSL (not open source since Aug 2023)

### License Action Items (OpenBao)

1. Rosenberg: Grundsatzfrage "Ist Docker-Compose mit AGPL-Service + MPL-2.0
   (Exhibit B) Service ein Larger Work?" — nächster Call
2. Nach V1 Alpha Launch (~Mai 2026): Direkte Anfrage an OpenBao/LF Edge:
   "SIDJUA is an AGPL-3.0 AI governance framework. Our V2 Enterprise edition
   (commercial license) plans to integrate OpenBao as a separate secrets service
   via API. Is the MPL-2.0 Exhibit B restriction relevant for this architecture?
   We are prepared to acquire commercial licenses if needed."
   Channel: OpenBao GitHub Discussions or LF Edge Legal
3. Infisical als Fallback evaluieren parallel zu OpenBao-Klärung
4. Tech-Architektur: Secrets-Backend als Interface abstrahieren (SecretsProvider)
   damit Backend austauschbar ohne Code-Änderung

### Secrets Backend Interface

```typescript
// Abstract interface — implementation swappable (SQLCipher, OpenBao, Infisical)
interface SecretsProvider {
  init(config: SecretsConfig): Promise<void>;
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string): Promise<string[]>;
  ensureNamespace(namespace: string): Promise<void>;
  rotate(namespace: string, key: string, newValue: string): Promise<void>;
  getMetadata(namespace: string, key: string): Promise<SecretMetadata>;
}

interface SecretMetadata {
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  last_accessed_by: string;  // agent_id
  rotation_age_days: number;
  version: number;
}

interface SecretsConfig {
  provider: "sqlcipher" | "infisical" | "openbao" | "conjur";
  // SQLCipher-specific (V1)
  db_path?: string;           // default: /.system/secrets.db
  // Infisical-specific (V2 primary)
  infisical_url?: string;
  infisical_token?: string;
  // OpenBao-specific (V2 Vault-compat)
  vault_addr?: string;
  vault_token?: string;
  // Conjur-specific (V2 CyberArk-compat)
  conjur_url?: string;
  conjur_account?: string;
  conjur_authn_login?: string;
  conjur_authn_api_key?: string;
}
```

### SQLCipher Schema (V1)

```sql
-- Encrypted SQLite database (SQLCipher)
-- File: /.system/secrets.db

CREATE TABLE IF NOT EXISTS secrets (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_encrypted BLOB NOT NULL,  -- Additional app-level encryption optional
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (namespace, key)
);

CREATE TABLE IF NOT EXISTS secret_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,  -- 'read' | 'write' | 'delete' | 'rotate'
  FOREIGN KEY (namespace, key) REFERENCES secrets(namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_access_timestamp ON secret_access_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_access_namespace ON secret_access_log(namespace);
```

### Namespace Path Structure

```
global/              # System-wide secrets
  db_encryption_key
  api_master_key
providers/           # AI provider API keys
  anthropic
  openai
  google
divisions/
  executive/         # Per-division secrets
  engineering/
  ...
```

### Apply Operations

```typescript
function applySecrets(config: ParsedConfig): void {
  // 1. Initialize SecretsProvider (SQLCipher for V1)
  const provider = createSecretsProvider(config.secrets || { provider: "sqlcipher" });
  await provider.init(config.secrets);

  // 2. Create namespace paths for each active division
  for (const div of config.activeDivisions) {
    await provider.ensureNamespace(`divisions/${div.code}`);
  }

  // 3. Ensure global + providers namespaces
  await provider.ensureNamespace("global");
  await provider.ensureNamespace("providers");

  // Note: apply does NOT populate secrets — user does via CLI or GUI
  // apply only ensures the STRUCTURE exists
}
```

## Step 5: RBAC

### Generated File: `/.system/rbac.yaml`

```yaml
# AUTO-GENERATED by sidjua apply — DO NOT EDIT MANUALLY
schema_version: "1.0"
generated_at: "2026-02-26T18:30:00Z"

roles:
  - role: system_admin
    permissions: ["*"]
    description: "Full system access (human only)"

  - role: division_head
    scope: own_division
    permissions:
      - read_all
      - write_all
      - approve_tasks
      - manage_agents
      - view_audit
      - view_costs

  - role: division_agent
    scope: own_division
    permissions:
      - read_workspace
      - write_workspace
      - read_knowledge
      - read_inbox
      - write_outbox
      - create_audit_entry

  - role: cross_division_reader
    scope: specified_divisions
    permissions:
      - read_outbox

assignments:
  - agent: opus-t1
    roles:
      - { role: division_head, division: executive }
      - { role: division_head, division: product }
      - { role: division_head, division: ai-governance }
      - { role: cross_division_reader, divisions: ["*"] }

  - agent: sonnet-t2
    roles:
      - { role: division_head, division: engineering }
      - { role: cross_division_reader, divisions: [product, ai-governance] }

  - agent: haiku-t3
    roles:
      - { role: division_head, division: customer-service }
      - { role: division_head, division: intelligence }
      - { role: division_agent, division: engineering }
```

### Generation Logic

```typescript
function generateRBAC(config: ParsedConfig): RBACConfig {
  const assignments: AgentAssignment[] = [];

  for (const div of config.activeDivisions) {
    if (div.head.agent) {
      addRole(assignments, div.head.agent, "division_head", div.code);
    }
  }

  // Tier-based cross-division access:
  // T1 agents: cross_division_reader for ALL divisions
  // T2 agents: cross_division_reader for related divisions
  // T3 agents: no cross-division access by default

  return { roles: DEFAULT_ROLES, assignments };
}
```

## Step 6: ROUTING

### Generated File: `/.system/routing-table.yaml`

```yaml
# AUTO-GENERATED by sidjua apply — DO NOT EDIT MANUALLY
schema_version: "1.0"
generated_at: "2026-02-26T18:30:00Z"

routes:
  - division: executive
    primary: opus-t1
    fallback: null

  - division: engineering
    primary: sonnet-t2
    fallback: opus-t1

  - division: customer-service
    primary: haiku-t3
    fallback: sonnet-t2

  - division: intelligence
    primary: haiku-t3
    fallback: opus-t1

default_route:
  agent: opus-t1
  action: classify_and_route
```

### Generation Logic

```typescript
function generateRouting(config: ParsedConfig): RoutingTable {
  const routes: Route[] = [];

  for (const div of config.activeDivisions) {
    routes.push({
      division: div.code,
      primary: div.head.agent || null,
      fallback: determineFallback(div, config)
    });
  }

  return {
    routes,
    default_route: {
      agent: findHighestTierAgent(config),
      action: "classify_and_route"
    }
  };
}

function determineFallback(div: Division, config: ParsedConfig): string | null {
  const headTier = getAgentTier(div.head.agent, config);
  if (headTier === 3) return findAgentByTier(2, config);
  if (headTier === 2) return findAgentByTier(1, config);
  return null;  // T1 → human escalation
}
```

## Step 7: SKILLS

### Per-Division: `/{division.code}/.meta/skills.yaml`

```yaml
division: engineering
skills:
  - name: read_file
    scope: own_division
  - name: write_file
    scope: own_division
  - name: search_knowledge
    scope: [own_division, shared]
  - name: execute_code
    scope: own_division
    requires_approval: false
  - name: git_operations
    scope: own_division
    requires_approval: false
  - name: deploy
    scope: own_division
    requires_approval: true
  - name: read_outbox
    scope: [product, ai-governance]
```

### Generation Logic

```typescript
const DIVISION_SKILL_TEMPLATES: Record<string, string[]> = {
  engineering: ["read_file", "write_file", "execute_code", "git_operations", "deploy"],
  sales: ["read_file", "write_file", "send_email_draft", "crm_access"],
  "customer-service": ["read_file", "write_file", "ticket_management", "knowledge_search"],
  _default: ["read_file", "write_file", "search_knowledge"]
};

function generateSkills(config: ParsedConfig): void {
  for (const div of config.activeDivisions) {
    const template = DIVISION_SKILL_TEMPLATES[div.code] || DIVISION_SKILL_TEMPLATES._default;
    const skills = template.map(s => ({
      name: s,
      scope: "own_division",
      requires_approval: isHighRiskSkill(s)
    }));

    // writeIfNotExists — user customizations are preserved
    writeIfNotExists(`/${div.code}/.meta/skills.yaml`, generateSkillsYaml(div.code, skills));
  }
}
```

## Step 8: AUDIT

```typescript
function applyAudit(config: ParsedConfig): void {
  // 1. Ensure audit_trail table exists (done in Step 3)

  // 2. Load or create default audit config
  const auditConfig = loadOrCreateAuditConfig(config);
  // Default: governance/audit/audit-config.yaml

  // 3. Create per-division audit views
  for (const div of config.activeDivisions) {
    db.exec(`CREATE VIEW IF NOT EXISTS audit_${sanitize(div.code)}
             AS SELECT * FROM audit_trail
             WHERE division_code = '${div.code}'`);
  }

  // 4. Create export directory
  ensureDir("/governance/audit/reports/");
}
```

### Default Audit Config (governance/audit/audit-config.yaml)

```yaml
schema_version: "1.0"
log_level: standard   # minimal | standard | verbose

events:
  task_start: true
  task_complete: true
  decision: true
  escalation: true          # Always true — cannot disable
  governance_check: true    # Always true — cannot disable
  error: true               # Always true — cannot disable
  approval_request: true    # Always true — cannot disable
  blocked: true             # Always true — cannot disable

retention:
  days: 365
  export_before_delete: true

export:
  formats: [json, csv]
  include_metadata: true
```

## Step 9: COST CENTERS

### Generated File: `/.system/cost-centers.yaml`

```yaml
# AUTO-GENERATED by sidjua apply — user limits preserved on re-apply
schema_version: "1.0"
generated_at: "2026-02-26T18:30:00Z"

global:
  monthly_limit_usd: null
  daily_limit_usd: null
  alert_threshold_percent: 80

divisions:
  executive:
    monthly_limit_usd: null
    daily_limit_usd: null
  engineering:
    monthly_limit_usd: null
    daily_limit_usd: null
  # ... per active division
```

### Merge Logic

```typescript
function applyCostCenters(config: ParsedConfig): void {
  const existing = loadExistingCostCenters();
  const updated = mergeCostCenters(existing, config.activeDivisions);
  // Merge: add new divisions, preserve user-set limits, remove inactive
  write("/.system/cost-centers.yaml", updated);
  syncCostBudgets(db, updated);
}
```

## Step 10: FINALIZE

### State File: `/.system/state.json`

```json
{
  "schema_version": "1.0",
  "last_apply": {
    "timestamp": "2026-02-26T18:30:00Z",
    "divisions_yaml_hash": "sha256:abc123...",
    "governance_hash": "sha256:def456...",
    "mode": "business",
    "active_divisions": ["executive", "legal", "finance", "product", "engineering"],
    "inactive_divisions": ["hr", "operations"],
    "db_version": "1.0",
    "agent_count": 3,
    "apply_duration_ms": 847
  },
  "history": [
    {
      "timestamp": "2026-02-26T18:30:00Z",
      "action": "apply",
      "changes": ["initial setup", "12 active divisions"]
    }
  ]
}
```

### README.md Auto-Generation

```typescript
function generateREADME(config: ParsedConfig): string {
  // Generates navigation README with:
  // - Company name, mode, size
  // - Active divisions list with scope
  // - Governance structure overview
  // - System file locations
  // - "Auto-generated by sidjua apply. Do not edit."
}
```

## CLI Interface

```
sidjua apply [options]

Options:
  --config <path>     Path to divisions.yaml (default: ./divisions.yaml)
  --dry-run           Show plan without executing
  --verbose           Detailed output per step
  --force             Skip confirmation prompts
  --step <name>       Run only specific step

Output (normal):
  ✓ VALIDATE     12 active, 2 inactive divisions
  ✓ FILESYSTEM   24 directories created, 0 skipped
  ✓ DATABASE     6 tables verified, 0 migrations pending
  ✓ SECRETS      14 namespaces verified
  ✓ RBAC         3 agents → 14 divisions
  ✓ ROUTING      14 routes, default → opus-t1
  ✓ SKILLS       14 configs (8 new, 6 preserved)
  ✓ AUDIT        14 views, retention: 365d
  ✓ COST_CENTERS 14 budgets configured
  ✓ FINALIZE     state.json + README.md written
  Applied in 847ms.
```

## Error Handling

### Strategy: Fail Fast, No Rollback

Each step is idempotent — re-running apply fixes partial state. No rollback needed.

| Category | Action | Example |
|----------|--------|---------|
| VALIDATION_ERROR | Abort before changes | Invalid YAML |
| FILESYSTEM_ERROR | Abort, log progress | Permission denied |
| DATABASE_ERROR | Abort, log progress | Disk full |
| GENERATION_ERROR | Skip step, warn | Can't determine fallback |

**Recovery:** Fix cause, run `sidjua apply` again.

## Personal Mode Differences

| Step | Difference |
|------|-----------|
| VALIDATE | No division codes required |
| FILESYSTEM | workspace/ instead of division dirs |
| DATABASE | division_code = "personal" for all |
| SECRETS | Single namespace: personal/ |
| RBAC | Simplified: owner + agents |
| ROUTING | All agents → workspace |
| SKILLS | Single skills.yaml |
| AUDIT | No per-division views |
| COST_CENTERS | Global only |

## Testing Checklist

- [ ] Parse valid divisions.yaml (SIDJUA's own)
- [ ] Parse personal mode config
- [ ] Reject invalid YAML (missing required fields)
- [ ] Create filesystem from scratch
- [ ] Re-run — verify idempotency
- [ ] Deactivate division — data preserved, routing updated
- [ ] Add division — all 8 systems updated
- [ ] Dry-run outputs plan without changes
- [ ] SQLite created with correct schema
- [ ] RBAC assigns T1/T2/T3 correctly
- [ ] Routing fallback: T3→T2→T1→human
- [ ] Cost center merge preserves user limits
- [ ] State file tracks history
- [ ] Personal → business migration
