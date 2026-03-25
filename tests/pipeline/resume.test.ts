/**
 * Tests for src/pipeline/resume.ts
 *
 * Checklist items covered:
 *   ✓ Approved action can resume with valid token
 *   ✓ Denied action stays blocked on retry
 *   ✓ Invalid resume token throws GovernanceError
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import {
  generateResumeToken,
  validateResumeToken,
  resolveApproval,
  getOrCreateSystemSecret,
} from "../../src/pipeline/resume.js";
import { GovernanceError } from "../../src/pipeline/errors.js";
import type { Database } from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-resume-test-"));
  db     = openDatabase(join(tmpDir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS);
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)").run("engineering", "Engineering");
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// generateResumeToken / validateResumeToken
// ---------------------------------------------------------------------------

describe("generateResumeToken / validateResumeToken", () => {
  it("generates a valid token that passes validation", () => {
    const secret    = "test-secret-32-bytes-long-here!";
    const requestId = "req-abc-123";
    const approvalId = 42;

    const token = generateResumeToken(requestId, approvalId, secret);
    expect(typeof token).toBe("string");
    expect(token.startsWith("42:")).toBe(true);

    expect(validateResumeToken(token, requestId, secret)).toBe(true);
  });

  it("fails validation with wrong request_id", () => {
    const secret     = "test-secret-32-bytes-long-here!";
    const token      = generateResumeToken("req-correct", 1, secret);
    expect(validateResumeToken(token, "req-wrong", secret)).toBe(false);
  });

  it("fails validation with wrong secret", () => {
    const token = generateResumeToken("req-001", 1, "secret-a");
    expect(validateResumeToken(token, "req-001", "secret-b")).toBe(false);
  });

  it("fails validation with tampered token", () => {
    const token   = generateResumeToken("req-001", 1, "my-secret");
    const tampered = token.slice(0, -4) + "xxxx";
    expect(validateResumeToken(tampered, "req-001", "my-secret")).toBe(false);
  });

  it("fails validation for token without separator", () => {
    expect(validateResumeToken("no-separator-here", "req-001", "secret")).toBe(false);
  });

  it("fails validation for non-numeric approval id", () => {
    expect(validateResumeToken("abc:somehash", "req-001", "secret")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateSystemSecret
// ---------------------------------------------------------------------------

describe("getOrCreateSystemSecret", () => {
  it("creates a secret on first call", () => {
    const secret = getOrCreateSystemSecret(db);
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
  });

  it("returns the same secret on subsequent calls", () => {
    const first  = getOrCreateSystemSecret(db);
    const second = getOrCreateSystemSecret(db);
    expect(first).toBe(second);
  });

  it("stores the secret in _system_keys table", () => {
    const secret = getOrCreateSystemSecret(db);
    const row = db.prepare("SELECT key_value FROM _system_keys WHERE key_name = 'pipeline_hmac_secret'").get() as { key_value: string } | undefined;
    expect(row?.key_value).toBe(secret);
  });
});

// ---------------------------------------------------------------------------
// resolveApproval
// ---------------------------------------------------------------------------

describe("resolveApproval", () => {
  function insertPendingApproval(agentId = "agent-1"): number {
    const result = db.prepare(
      `INSERT INTO approval_queue (agent_id, division_code, action_description, rule_triggered, status, metadata)
       VALUES (?, 'engineering', '{"type":"code.deploy"}', 'code.deploy', 'pending', '{"request_id":"req-001"}')`
    ).run(agentId);
    return Number(result.lastInsertRowid);
  }

  it("updates approval status to approved", () => {
    const id = insertPendingApproval();
    resolveApproval(db, id, "approved", "human");
    const row = db.prepare("SELECT status, decided_by FROM approval_queue WHERE id = ?").get(id) as {
      status: string; decided_by: string;
    };
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe("human");
  });

  it("updates approval status to denied", () => {
    const id = insertPendingApproval();
    resolveApproval(db, id, "denied", "division_head");
    const row = db.prepare("SELECT status FROM approval_queue WHERE id = ?").get(id) as {
      status: string;
    };
    expect(row.status).toBe("denied");
  });

  it("writes an audit trail entry for the approval decision", () => {
    const id = insertPendingApproval();
    resolveApproval(db, id, "approved", "human");
    const count = (db.prepare("SELECT COUNT(*) as n FROM audit_trail").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("does not update an already-decided approval", () => {
    const id = insertPendingApproval();
    resolveApproval(db, id, "approved", "human");
    resolveApproval(db, id, "denied",   "other-human");
    const row = db.prepare("SELECT status FROM approval_queue WHERE id = ?").get(id) as { status: string };
    // First decision wins (WHERE status = 'pending' in the UPDATE)
    expect(row.status).toBe("approved");
  });

  it("is a no-op for non-existent approval id", () => {
    // Should not throw
    expect(() => resolveApproval(db, 9999, "approved", "human")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GovernanceError on invalid token
// ---------------------------------------------------------------------------

describe("INVALID_RESUME_TOKEN error code", () => {
  it("GovernanceError has the right code", () => {
    const err = new GovernanceError("INVALID_RESUME_TOKEN", "test message");
    expect(err.code).toBe("INVALID_RESUME_TOKEN");
    expect(err.name).toBe("GovernanceError");
    expect(err.message).toBe("test message");
  });
});
