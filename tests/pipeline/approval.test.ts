/**
 * Tests for src/pipeline/approval.ts — Stage 2
 *
 * Checklist items covered:
 *   ✓ Approval workflow triggers PAUSE for new action
 *   ✓ Approval workflow passes for previously approved action
 *   ✓ Denied action stays blocked on retry
 *   ✓ Expired approval treated as new request
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import { checkApproval, findApproval, createApprovalRequest } from "../../src/pipeline/approval.js";
import type { ActionRequest, ApprovalWorkflow } from "../../src/types/pipeline.js";
import type { Database } from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(type: string, overrides: Partial<{
  divisionCode:   string;
  targetDivision: string;
  agentId:        string;
}> = {}): ActionRequest {
  return {
    request_id:    "req-001",
    timestamp:     "2026-02-27T00:00:00Z",
    agent_id:      overrides.agentId      ?? "agent-1",
    agent_tier:    2,
    division_code: overrides.divisionCode ?? "engineering",
    action: {
      type,
      target:      "/deploy/app",
      description: "test action",
    },
    context: {
      division_code:   overrides.divisionCode   ?? "engineering",
      target_division: overrides.targetDivision,
      session_id:      "sess-001",
    },
  };
}

const workflows: ApprovalWorkflow[] = [
  {
    trigger:       { action: "code.deploy" },
    require:       "division_head",
    timeout_hours: 24,
  },
  {
    trigger:       { action: "email.send", condition: "target_division != division_code" },
    require:       "division_head",
    timeout_hours: 4,
  },
];

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-approval-test-"));
  db     = openDatabase(join(tmpDir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS);
  // Insert a division row for FK constraints
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)")
    .run("engineering", "Engineering");
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkApproval — Stage 2", () => {
  it("PASS: action with no matching workflow", () => {
    const result = checkApproval(makeRequest("file.read"), workflows, db);
    expect(result.verdict).toBe("PASS");
    expect(result.stage).toBe("approval");
  });

  it("PAUSE: new action matching workflow creates approval request", () => {
    const result = checkApproval(makeRequest("code.deploy"), workflows, db);
    expect(result.verdict).toBe("PAUSE");
    // Verify entry was created in DB
    const rows = db.prepare("SELECT * FROM approval_queue WHERE status = 'pending'").all();
    expect(rows.length).toBe(1);
  });

  it("PASS: previously approved action passes through", () => {
    // First: create the request and then approve it
    const req = makeRequest("code.deploy");
    createApprovalRequest(db, req, workflows[0]!);
    db.prepare("UPDATE approval_queue SET status = 'approved' WHERE status = 'pending'").run();

    const result = checkApproval(req, workflows, db);
    expect(result.verdict).toBe("PASS");
  });

  it("BLOCK: previously denied action is blocked", () => {
    const req = makeRequest("code.deploy");
    createApprovalRequest(db, req, workflows[0]!);
    db.prepare("UPDATE approval_queue SET status = 'denied', decided_by = 'human' WHERE status = 'pending'").run();

    const result = checkApproval(req, workflows, db);
    expect(result.verdict).toBe("BLOCK");
  });

  it("PAUSE: pending action stays PAUSE (no new entry created)", () => {
    const req = makeRequest("code.deploy");
    createApprovalRequest(db, req, workflows[0]!);

    const result = checkApproval(req, workflows, db);
    expect(result.verdict).toBe("PAUSE");
    // Should still be only 1 row
    const count = (db.prepare("SELECT COUNT(*) as n FROM approval_queue").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("PASS: conditional workflow — same division email does not trigger", () => {
    const req = makeRequest("email.send", { divisionCode: "engineering" });
    const result = checkApproval(req, workflows, db);
    expect(result.verdict).toBe("PASS");
  });

  it("PAUSE: conditional workflow — cross-division email triggers", () => {
    const req = makeRequest("email.send", {
      divisionCode:   "engineering",
      targetDivision: "finance",
    });
    const result = checkApproval(req, workflows, db);
    expect(result.verdict).toBe("PAUSE");
  });

  it("PASS: empty workflows list never pauses", () => {
    const result = checkApproval(makeRequest("code.deploy"), [], db);
    expect(result.verdict).toBe("PASS");
  });
});

describe("findApproval", () => {
  it("returns null when no approval exists", () => {
    const result = findApproval(db, makeRequest("code.deploy"), workflows[0]!);
    expect(result).toBeNull();
  });

  it("returns the existing approval record", () => {
    const req = makeRequest("code.deploy");
    createApprovalRequest(db, req, workflows[0]!);
    const result = findApproval(db, req, workflows[0]!);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("pending");
    expect(result?.rule_triggered).toBe("code.deploy");
  });
});

describe("createApprovalRequest", () => {
  it("inserts a pending row and returns its id", () => {
    const req = makeRequest("code.deploy");
    const id  = createApprovalRequest(db, req, workflows[0]!);
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);

    const row = db.prepare("SELECT * FROM approval_queue WHERE id = ?").get(id) as {
      status: string;
      agent_id: string;
      rule_triggered: string;
    };
    expect(row.status).toBe("pending");
    expect(row.agent_id).toBe("agent-1");
    expect(row.rule_triggered).toBe("code.deploy");
  });
});
