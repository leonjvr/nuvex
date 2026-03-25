// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/api/routes/audit.ts — compliance reporting REST endpoints
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { randomUUID } from "node:crypto";
import { Hono }   from "hono";
import { openDatabase } from "../../../src/utils/db.js";
import { runAuditMigrations } from "../../../src/core/audit/audit-migrations.js";
import { registerAuditRoutes } from "../../../src/api/routes/audit.js";
import { createErrorHandler }  from "../../../src/api/middleware/error-handler.js";
import { withAdminCtx }        from "../../helpers/with-admin-ctx.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-audit-api-test-"));
}

function openTestDb(workDir: string) {
  const systemDir = join(workDir, ".system");
  mkdirSync(systemDir, { recursive: true });
  const db = openDatabase(join(systemDir, "sidjua.db"));
  runAuditMigrations(db);
  return db;
}

function insertEvent(
  db: ReturnType<typeof openDatabase>,
  opts: {
    agentId?:  string;
    division?: string;
    action?:   "allowed" | "blocked" | "escalated";
    severity?: "low" | "medium" | "high" | "critical";
    ruleId?:   string;
  } = {},
) {
  db.prepare(
    "INSERT INTO audit_events (id, timestamp, agent_id, division, event_type, rule_id, action, severity, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    new Date().toISOString(),
    opts.agentId  ?? "agent-1",
    opts.division ?? "engineering",
    "policy_check",
    opts.ruleId   ?? "RULE-001",
    opts.action   ?? "allowed",
    opts.severity ?? "low",
    "{}",
  );
}

function buildApp(db: ReturnType<typeof openDatabase>): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  registerAuditRoutes(app, { db });
  return app;
}

// ===========================================================================

describe("GET /api/v1/audit/report", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;
  let app: Hono;

  beforeEach(() => {
    tmp = makeTempDir();
    db  = openTestDb(tmp);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 200 with AuditReport shape", async () => {
    const res  = await app.request("/api/v1/audit/report");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("generatedAt");
    expect(body).toHaveProperty("complianceScore");
    expect(body).toHaveProperty("rulesEnforced");
    expect(body).toHaveProperty("totalEvents");
    expect(body).toHaveProperty("summary");
  });

  it("returns 200 with empty data on fresh install (no events)", async () => {
    const res  = await app.request("/api/v1/audit/report");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["totalEvents"]).toBe(0);
    expect(body["complianceScore"]).toBe(100);
  });

  it("accepts division and agent query params", async () => {
    insertEvent(db, { division: "engineering" });
    const res = await app.request("/api/v1/audit/report?division=engineering");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["totalEvents"]).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/v1/audit/violations", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;
  let app: Hono;

  beforeEach(() => {
    tmp = makeTempDir();
    db  = openTestDb(tmp);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 200 with array", async () => {
    const res  = await app.request("/api/v1/audit/violations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns X-Total-Count header", async () => {
    insertEvent(db, { action: "blocked" });
    const res = await app.request("/api/v1/audit/violations");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-total-count")).toBeDefined();
  });

  it("returns only violations (blocked/escalated)", async () => {
    insertEvent(db, { action: "allowed"   });
    insertEvent(db, { action: "blocked"   });
    insertEvent(db, { action: "escalated" });

    const res  = await app.request("/api/v1/audit/violations");
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body.every((v) => ["blocked", "escalated"].includes(v["action"] as string))).toBe(true);
  });

  it("rejects invalid severity param with 400", async () => {
    const res = await app.request("/api/v1/audit/violations?severity=superduper");
    expect(res.status).toBe(400);
  });

  it("supports limit and offset pagination", async () => {
    for (let i = 0; i < 5; i++) insertEvent(db, { action: "blocked" });

    const res  = await app.request("/api/v1/audit/violations?limit=2&offset=0");
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(2);
  });

  it("rejects invalid limit param with 400", async () => {
    const res = await app.request("/api/v1/audit/violations?limit=9999");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/v1/audit/agents", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;
  let app: Hono;

  beforeEach(() => {
    tmp = makeTempDir();
    db  = openTestDb(tmp);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 200 with array", async () => {
    const res  = await app.request("/api/v1/audit/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns X-Total-Count header", async () => {
    const res = await app.request("/api/v1/audit/agents");
    expect(res.headers.get("x-total-count")).toBeDefined();
  });

  it("each agent record has expected shape", async () => {
    insertEvent(db, { agentId: "agent-abc", action: "allowed" });
    const res  = await app.request("/api/v1/audit/agents");
    const body = await res.json() as Array<Record<string, unknown>>;
    if (body.length > 0) {
      expect(body[0]).toHaveProperty("agentId");
      expect(body[0]).toHaveProperty("trustScore");
      expect(body[0]).toHaveProperty("trend");
    }
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/v1/audit/summary", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;
  let app: Hono;

  beforeEach(() => {
    tmp = makeTempDir();
    db  = openTestDb(tmp);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 200 with AuditSummary shape", async () => {
    const res  = await app.request("/api/v1/audit/summary");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("period");
    expect(body).toHaveProperty("totalViolations");
    expect(body).toHaveProperty("complianceRate");
    expect(body).toHaveProperty("topViolationTypes");
    expect(body).toHaveProperty("divisionBreakdown");
  });

  it("returns complianceRate 100 with zero events", async () => {
    const res  = await app.request("/api/v1/audit/summary");
    const body = await res.json() as Record<string, unknown>;
    expect(body["complianceRate"]).toBe(100);
    expect(body["totalViolations"]).toBe(0);
  });

  it("filters by since query param", async () => {
    const res = await app.request("/api/v1/audit/summary?since=2099-01-01T00:00:00Z&until=2099-12-31T23:59:59Z");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["totalViolations"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/v1/audit/export", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;
  let app: Hono;

  beforeEach(() => {
    tmp = makeTempDir();
    db  = openTestDb(tmp);
    app = buildApp(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns JSON export with Content-Disposition header", async () => {
    const res = await app.request("/api/v1/audit/export?format=json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(".json");
  });

  it("returns CSV export with text/csv Content-Type", async () => {
    const res = await app.request("/api/v1/audit/export?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("rejects unknown format with 400", async () => {
    const res = await app.request("/api/v1/audit/export?format=pdf");
    expect(res.status).toBe(400);
  });

  it("JSON export contains report, violations, agents, summary keys", async () => {
    insertEvent(db, { action: "blocked" });
    const res  = await app.request("/api/v1/audit/export?format=json");
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("report");
    expect(body).toHaveProperty("violations");
    expect(body).toHaveProperty("agents");
    expect(body).toHaveProperty("summary");
  });
});
