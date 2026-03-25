// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SQL Injection prevention tests for the audit subsystem (#519 B1).
 *
 * Covers:
 *   - sanitizeLikePattern() escaping
 *   - buildEventWhere alias whitelist (via AuditService public API)
 *   - AuditService filter parameterization with injection payloads
 *   - Audit route LIKE pattern sanitization
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync }               from "node:fs";
import { tmpdir }                                        from "node:os";
import { join }                                          from "node:path";
import { randomUUID }                                    from "node:crypto";
import { sanitizeLikePattern, assertSafeColumn }         from "../../src/utils/sql-utils.js";
import { openDatabase }                                  from "../../src/utils/db.js";
import { AuditService }                                  from "../../src/core/audit/audit-service.js";
import { runAuditMigrations }                            from "../../src/core/audit/audit-migrations.js";
import { Hono }                                          from "hono";
import { registerAuditRoutes }                           from "../../src/api/routes/audit.js";
import { withAdminCtx }                                  from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTempDb() {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-sqlinj-test-"));
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
  const db = openDatabase(join(tmpDir, ".system", "sidjua.db"));
  runAuditMigrations(db);
  return db;
}

function insertEvent(db: ReturnType<typeof openDatabase>, opts: {
  agentId?: string; division?: string; action?: string; severity?: string;
} = {}) {
  db.prepare(
    "INSERT INTO audit_events (id, timestamp, agent_id, division, event_type, rule_id, action, severity, details, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    new Date().toISOString(),
    opts.agentId  ?? "agent-1",
    opts.division ?? "engineering",
    "policy_check",
    "RULE-001",
    opts.action   ?? "allowed",
    opts.severity ?? "low",
    JSON.stringify({ reason: "test" }),
    null,
  );
}

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Task 2: sanitizeLikePattern
// ---------------------------------------------------------------------------

describe("sanitizeLikePattern", () => {
  it("passes through normal strings unchanged", () => {
    expect(sanitizeLikePattern("hello world")).toBe("hello world");
    expect(sanitizeLikePattern("abc-123")).toBe("abc-123");
  });

  it("escapes % so it is not treated as a wildcard", () => {
    expect(sanitizeLikePattern("50%")).toBe("50\\%");
  });

  it("escapes _ so it is not treated as a single-char wildcard", () => {
    expect(sanitizeLikePattern("user_name")).toBe("user\\_name");
  });

  it("escapes \\ so the escape char itself is not ambiguous", () => {
    expect(sanitizeLikePattern("C:\\path")).toBe("C:\\\\path");
  });

  it("escapes combined special characters", () => {
    const input    = "100% complete_job\\done";
    const expected = "100\\% complete\\_job\\\\done";
    expect(sanitizeLikePattern(input)).toBe(expected);
  });

  it("handles empty string", () => {
    expect(sanitizeLikePattern("")).toBe("");
  });

  it("LIKE injection: %' OR '1'='1 cannot alter query semantics", () => {
    // After escaping, % is literal — the resulting LIKE pattern won't match extra rows
    const malicious = "%' OR '1'='1";
    const safe      = sanitizeLikePattern(malicious);
    expect(safe).toContain("\\%");
    expect(safe).not.toMatch(/^%/);   // no leading unescaped wildcard
  });
});

// ---------------------------------------------------------------------------
// assertSafeColumn
// ---------------------------------------------------------------------------

describe("assertSafeColumn", () => {
  const whitelist = new Set(["timestamp", "agent_id", "division"]);

  it("allows whitelisted columns", () => {
    expect(() => assertSafeColumn("timestamp",  whitelist)).not.toThrow();
    expect(() => assertSafeColumn("agent_id",   whitelist)).not.toThrow();
    expect(() => assertSafeColumn("division",   whitelist)).not.toThrow();
  });

  it("throws for unknown columns", () => {
    expect(() => assertSafeColumn("unknown_col",  whitelist)).toThrow(TypeError);
    expect(() => assertSafeColumn("DROP TABLE",   whitelist)).toThrow(TypeError);
    expect(() => assertSafeColumn("'; SELECT 1;", whitelist)).toThrow(TypeError);
  });

  it("throws for empty string when not in whitelist", () => {
    const noEmpty = new Set(["id"]);
    expect(() => assertSafeColumn("", noEmpty)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Task 1: AuditService — SQL injection via filter values
// ---------------------------------------------------------------------------

describe("AuditService — filter parameterization prevents injection", () => {
  it("SQL injection in division filter does not corrupt the database", async () => {
    const db  = makeTempDb();
    const svc = new AuditService(db);
    insertEvent(db, { division: "engineering" });

    // Injection payload as division value — should be treated as literal string
    const injectionPayload = "'; DROP TABLE audit_events; --";
    const violations = await svc.getViolations({ division: injectionPayload });

    // Parameterized query: no rows match, no crash, table still exists
    expect(violations).toHaveLength(0);
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_events'").get();
    expect(tableExists).toBeDefined();
    db.close();
  });

  it("SQL injection in agentId filter does not match unintended rows", async () => {
    const db  = makeTempDb();
    const svc = new AuditService(db);
    insertEvent(db, { agentId: "agent-real", action: "blocked" });

    // Payload designed to bypass the agent_id filter
    const injectionPayload = "' OR '1'='1";
    const violations = await svc.getViolations({ agentId: injectionPayload });
    expect(violations).toHaveLength(0);   // parameterized — won't match "agent-real"
    db.close();
  });

  it("empty filters return results without error", async () => {
    const db  = makeTempDb();
    const svc = new AuditService(db);
    insertEvent(db, { action: "blocked" });

    const violations = await svc.getViolations({});
    expect(violations).toHaveLength(1);
    db.close();
  });

  it("valid division filter correctly scopes results", async () => {
    const db  = makeTempDb();
    const svc = new AuditService(db);
    insertEvent(db, { division: "engineering", action: "blocked" });
    insertEvent(db, { division: "security",    action: "blocked" });

    const result = await svc.getViolations({ division: "engineering" });
    expect(result).toHaveLength(1);
    expect(result[0]!.division).toBe("engineering");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Task 4: Audit route LIKE via API — malicious taskId
// ---------------------------------------------------------------------------

describe("Audit route — LIKE injection prevention via taskId param", () => {
  function buildTestApp() {
    const db  = makeTempDb();
    // Create audit_trail table (needed by the route)
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_trail (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp      TEXT NOT NULL,
        agent_id       TEXT NOT NULL,
        division_code  TEXT,
        action_type    TEXT NOT NULL,
        parent_task_id TEXT,
        metadata       TEXT
      );
      INSERT INTO audit_trail (timestamp, agent_id, division_code, action_type, parent_task_id, metadata)
      VALUES ('2026-01-01T00:00:00Z', 'agent-1', 'eng', 'policy_check', 'real-task-id', '{"ref":"real-task-id"}');
    `);

    const app = new Hono();
    app.use("*", withAdminCtx);
    registerAuditRoutes(app, { db });
    return { app, db };
  }

  it("normal taskId returns matching row", async () => {
    const { app, db } = buildTestApp();
    const res  = await app.request("/api/v1/audit/tasks/real-task-id");
    const body = await res.json() as { task_id: string; events: unknown[] };
    expect(res.status).toBe(200);
    expect(body.task_id).toBe("real-task-id");
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("LIKE injection in taskId does not return extra rows", async () => {
    const { app, db } = buildTestApp();
    // A % wildcard would match all rows if unescaped
    const res  = await app.request("/api/v1/audit/tasks/%25");  // URL-encoded %
    const body = await res.json() as { task_id: string; events: unknown[] };
    expect(res.status).toBe(200);
    // Should return 0 events — parent_task_id is not literally "%" and
    // the LIKE pattern is escaped so "%" is literal, not a wildcard
    expect(body.events).toHaveLength(0);
    db.close();
  });

  it("_ wildcard in taskId is escaped", async () => {
    const { app, db } = buildTestApp();
    // "_" would match any single char without escaping
    const res  = await app.request("/api/v1/audit/tasks/real_task_id");
    const body = await res.json() as { task_id: string; events: unknown[] };
    expect(res.status).toBe(200);
    // Should not match "real-task-id" because "_" is now escaped to literal
    expect(body.events).toHaveLength(0);
    db.close();
  });
});
