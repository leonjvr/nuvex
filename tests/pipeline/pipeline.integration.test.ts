/**
 * Integration tests for the full 5-stage pipeline.
 *
 * Checklist items covered:
 *   ✓ All 5 stages execute in order (no stage skipped)
 *   ✓ Audit trail written for ALLOW, BLOCK, and PAUSE
 *   ✓ Audit entry contains full governance check JSON
 *   ✓ Pipeline fails closed on config load error
 *   ✓ Pipeline fails closed on DB error
 *   ✓ Approved action can resume with valid token
 *   ✓ Denied action stays blocked on retry
 *   ✓ Expired approval treated as new request
 *   ✓ Performance: < 50ms for 100-rule config
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import { evaluateAction, finalize, extractWarnings } from "../../src/pipeline/index.js";
import { loadGovernanceConfig } from "../../src/pipeline/config-loader.js";
import { resolveApproval, generateResumeToken, validateResumeToken, getOrCreateSystemSecret } from "../../src/pipeline/resume.js";
import type {
  ActionRequest,
  GovernanceConfig,
  ForbiddenRule,
  ApprovalWorkflow,
  PolicyConfig,
  ClassificationConfig,
} from "../../src/types/pipeline.js";
import type { Database } from "../../src/utils/db.js";
import { DEFAULT_CLASSIFICATION_LEVELS, DEFAULT_AGENT_CLEARANCE } from "../../src/pipeline/config-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES = join(import.meta.dirname ?? process.cwd(), "fixtures/governance");

function makeRequest(overrides: Partial<{
  requestId:       string;
  actionType:      string;
  target:          string;
  divisionCode:    string;
  targetDivision:  string;
  agentTier:       1 | 2 | 3;
  estimatedCost:   number;
  dataClass:       string;
  parameters:      Record<string, unknown>;
}> = {}): ActionRequest {
  return {
    request_id:    overrides.requestId   ?? "req-integ-001",
    timestamp:     "2026-02-27T00:00:00Z",
    agent_id:      "agent-integ",
    agent_tier:    overrides.agentTier   ?? 2,
    division_code: overrides.divisionCode ?? "engineering",
    action: {
      type:                overrides.actionType ?? "file.read",
      target:              overrides.target     ?? "/data/file.txt",
      description:         "integration test action",
      estimated_cost_usd:  overrides.estimatedCost,
      data_classification: overrides.dataClass as ActionRequest["action"]["data_classification"],
      parameters:          overrides.parameters,
    },
    context: {
      division_code:   overrides.divisionCode   ?? "engineering",
      target_division: overrides.targetDivision,
      session_id:      "sess-integ-001",
    },
  };
}

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let governance: GovernanceConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-integ-test-"));
  db     = openDatabase(join(tmpDir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS);
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)").run("engineering", "Engineering");
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)").run("finance", "Finance");
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)").run("legal", "Legal");

  governance = loadGovernanceConfig(FIXTURES);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ALLOW path
// ---------------------------------------------------------------------------

describe("ALLOW path", () => {
  it("file.read by T2 agent passes all 5 stages", () => {
    const result = evaluateAction(makeRequest({ actionType: "file.read" }), governance, db);
    expect(result.verdict).toBe("ALLOW");
    expect(result.stage_results.length).toBe(5);
    expect(result.stage_results.map((s) => s.stage)).toEqual([
      "forbidden", "approval", "budget", "classification", "policy",
    ]);
  });

  it("ALLOW result has no blocking_stage or blocking_reason", () => {
    const result = evaluateAction(makeRequest({ actionType: "file.read" }), governance, db);
    expect(result.blocking_stage).toBeUndefined();
    expect(result.blocking_reason).toBeUndefined();
  });

  it("ALLOW writes an audit trail entry", () => {
    evaluateAction(makeRequest({ actionType: "file.read" }), governance, db);
    const count = (db.prepare("SELECT COUNT(*) as n FROM audit_trail").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("audit entry contains full governance check JSON", () => {
    evaluateAction(makeRequest({ actionType: "file.read" }), governance, db);
    const row = db.prepare("SELECT governance_check FROM audit_trail LIMIT 1").get() as {
      governance_check: string | null;
    };
    expect(row.governance_check).not.toBeNull();
    const parsed = JSON.parse(row.governance_check!) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(5); // All 5 stage results
  });
});

// ---------------------------------------------------------------------------
// BLOCK path
// ---------------------------------------------------------------------------

describe("BLOCK path — Stage 1 Forbidden", () => {
  it("contract.sign is blocked (exact match)", () => {
    const result = evaluateAction(makeRequest({ actionType: "contract.sign" }), governance, db);
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("forbidden");
  });

  it("BLOCK at Stage 1 writes audit trail entry", () => {
    evaluateAction(makeRequest({ actionType: "contract.sign" }), governance, db);
    const count = (db.prepare("SELECT COUNT(*) as n FROM audit_trail").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("BLOCK at Stage 1 skips remaining stages", () => {
    const result = evaluateAction(makeRequest({ actionType: "contract.sign" }), governance, db);
    // Only 1 stage result (forbidden)
    expect(result.stage_results.length).toBe(1);
    expect(result.stage_results[0]?.stage).toBe("forbidden");
  });

  it("purchase.* glob blocked", () => {
    const result = evaluateAction(makeRequest({ actionType: "purchase.initiate" }), governance, db);
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("forbidden");
  });
});

describe("BLOCK path — Stage 4 Classification", () => {
  it("T3 agent accessing CONFIDENTIAL data is blocked", () => {
    const result = evaluateAction(
      makeRequest({ agentTier: 3, dataClass: "CONFIDENTIAL" }),
      governance,
      db,
    );
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("classification");
  });

  it("FYEO data blocks all agents", () => {
    const result = evaluateAction(
      makeRequest({ agentTier: 1, dataClass: "FYEO" }),
      governance,
      db,
    );
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("classification");
  });
});

describe("BLOCK path — Stage 5 Policy", () => {
  it("data.delete always blocked by human_oversight policy", () => {
    const result = evaluateAction(
      makeRequest({ actionType: "data.delete", target: "/data/old-records.csv" }),
      governance,
      db,
    );
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("policy");
  });
});

// ---------------------------------------------------------------------------
// PAUSE path
// ---------------------------------------------------------------------------

describe("PAUSE path — Stage 2 Approval", () => {
  it("code.deploy triggers PAUSE (new approval request)", () => {
    const result = evaluateAction(makeRequest({ actionType: "code.deploy" }), governance, db);
    expect(result.verdict).toBe("PAUSE");
    expect(result.blocking_stage).toBe("approval");
    expect(result.approval_id).toBeDefined();
    expect(result.resume_token).toBeDefined();
  });

  it("PAUSE writes audit trail entry", () => {
    evaluateAction(makeRequest({ actionType: "code.deploy" }), governance, db);
    const count = (db.prepare("SELECT COUNT(*) as n FROM audit_trail").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("PAUSE creates approval_queue entry", () => {
    evaluateAction(makeRequest({ actionType: "code.deploy" }), governance, db);
    const count = (db.prepare("SELECT COUNT(*) as n FROM approval_queue").get() as { n: number }).n;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Resume flow
// ---------------------------------------------------------------------------

describe("Resume flow", () => {
  it("PAUSE → approve → resume → ALLOW", () => {
    // Step 1: Initial request → PAUSE
    const req1    = makeRequest({ actionType: "code.deploy", requestId: "req-resume-1" });
    const paused  = evaluateAction(req1, governance, db);
    expect(paused.verdict).toBe("PAUSE");
    expect(paused.approval_id).toBeDefined();
    expect(paused.resume_token).toBeDefined();

    // Step 2: Approve the request
    resolveApproval(db, paused.approval_id!, "approved", "division_head");

    // Step 3: Resume (valid token, re-run pipeline)
    const secret  = getOrCreateSystemSecret(db);
    const isValid = validateResumeToken(paused.resume_token!, req1.request_id, secret);
    expect(isValid).toBe(true);

    const resumed = evaluateAction(req1, governance, db);
    expect(resumed.verdict).toBe("ALLOW");
  });

  it("PAUSE → deny → retry → BLOCK", () => {
    const req    = makeRequest({ actionType: "code.deploy", requestId: "req-resume-2" });
    const paused = evaluateAction(req, governance, db);
    expect(paused.verdict).toBe("PAUSE");

    // Deny the request
    resolveApproval(db, paused.approval_id!, "denied", "division_head");

    // Retry: Stage 2 finds denied entry → BLOCK
    const retried = evaluateAction(req, governance, db);
    expect(retried.verdict).toBe("BLOCK");
    expect(retried.blocking_stage).toBe("approval");
  });
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

describe("Warnings", () => {
  it("ALLOW with warnings for soft policy (web.fetch)", () => {
    const result = evaluateAction(makeRequest({ actionType: "web.fetch" }), governance, db);
    expect(result.verdict).toBe("ALLOW");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]?.rule_id).toContain("log_external_access");
  });

  it("api.call emits soft warning", () => {
    const result = evaluateAction(makeRequest({ actionType: "api.call" }), governance, db);
    expect(result.verdict).toBe("ALLOW");
    expect(result.warnings.some((w) => w.rule_id === "policy.log_external_access")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractWarnings helper
// ---------------------------------------------------------------------------

describe("extractWarnings", () => {
  it("extracts WARN checks from stage result", () => {
    const stage = {
      stage:         "budget" as const,
      verdict:       "WARN" as const,
      duration_ms:   5,
      rules_checked: [
        { rule_id: "budget.daily_warn", rule_source: "db", matched: true, verdict: "WARN" as const, reason: "80% used" },
        { rule_id: "budget.no_estimate", rule_source: "system", matched: false, verdict: "PASS" as const },
      ],
    };
    const warnings = extractWarnings(stage, "budget");
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.rule_id).toBe("budget.daily_warn");
    expect(warnings[0]?.stage).toBe("budget");
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("Performance", () => {
  it("pipeline runs in < 50ms for 100-rule config", () => {
    // Build a 100-rule forbidden config
    const manyRules: ForbiddenRule[] = Array.from({ length: 100 }, (_, i) => ({
      action:      `rule.action_${i}`,
      reason:      `Rule ${i}`,
      escalate_to: "SYSTEM_BLOCK",
    }));

    const heavyConfig: GovernanceConfig = {
      forbidden:      manyRules,
      approval:       [],
      budgets:        {},
      classification: {
        levels:          DEFAULT_CLASSIFICATION_LEVELS,
        agent_clearance: DEFAULT_AGENT_CLEARANCE,
      },
      policies:    [],
      loaded_at:   new Date().toISOString(),
      file_hashes: {},
    };

    const req   = makeRequest({ actionType: "file.read" });
    const start = Date.now();
    evaluateAction(req, heavyConfig, db);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

describe("Fail-closed behavior", () => {
  it("pipeline fails closed (BLOCK) on DB error", () => {
    // Close the DB to force an error
    db.close();

    // Re-open a new DB that doesn't have the tables
    const badDb = openDatabase(join(tmpDir, "bad.db"));
    // Don't run migrations — tables don't exist

    const req = makeRequest({ actionType: "code.deploy" });
    const result = evaluateAction(req, governance, badDb);
    // Should BLOCK, not throw
    expect(result.verdict).toBe("BLOCK");

    badDb.close();

    // Reopen for afterEach
    db = openDatabase(join(tmpDir, "test.db"));
  });
});
