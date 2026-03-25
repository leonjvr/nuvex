/**
 * Phase 11b: System route handler tests
 *
 * Covers: divisions, costs, audit, governance, logging, orchestrator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import BetterSqlite3 from "better-sqlite3";

import { registerDivisionRoutes }     from "../../../src/api/routes/divisions.js";
import { registerCostRoutes }         from "../../../src/api/routes/costs.js";
import { registerAuditRoutes }        from "../../../src/api/routes/audit.js";
import { registerGovernanceRoutes }   from "../../../src/api/routes/governance.js";
import { registerLoggingRoutes }      from "../../../src/api/routes/logging.js";
import { registerOrchestratorRoutes } from "../../../src/api/routes/orchestrator.js";
import { resetLogger }                from "../../../src/core/logger.js";
import { createErrorHandler }         from "../../../src/api/middleware/error-handler.js";
import { withAdminCtx }               from "../../helpers/with-admin-ctx.js";

type Db = InstanceType<typeof BetterSqlite3>;

afterEach(() => {
  resetLogger();
});

// ---------------------------------------------------------------------------
// Helper: bare Hono app + route
// ---------------------------------------------------------------------------

function makeApp(): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  return app;
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

describe("GET /api/v1/divisions", () => {
  it("returns empty list when table does not exist", async () => {
    const db  = new BetterSqlite3(":memory:");
    const app = makeApp();
    registerDivisionRoutes(app, { db });

    const res = await app.request("/api/v1/divisions");
    expect(res.status).toBe(200);
    const body = await res.json() as { divisions: unknown[] };
    expect(Array.isArray(body.divisions)).toBe(true);
  });

  it("returns divisions from DB when table exists", async () => {
    const db = new BetterSqlite3(":memory:");
    db.exec(`CREATE TABLE divisions (code TEXT PRIMARY KEY, name_en TEXT, active INTEGER, created_at TEXT, updated_at TEXT)`);
    db.prepare("INSERT INTO divisions VALUES (?,?,1,?,?)").run("eng", "Engineering", "2026-01-01", "2026-01-01");

    const app = makeApp();
    registerDivisionRoutes(app, { db });

    const res = await app.request("/api/v1/divisions");
    expect(res.status).toBe(200);
    const body = await res.json() as { divisions: unknown[] };
    expect(body.divisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

describe("GET /api/v1/costs", () => {
  it("returns empty breakdown when table does not exist", async () => {
    const db  = new BetterSqlite3(":memory:");
    const app = makeApp();
    registerCostRoutes(app, { db });

    const res  = await app.request("/api/v1/costs?period=7d");
    expect(res.status).toBe(200);
    const body = await res.json() as { breakdown: unknown[]; total: { total_usd: number } };
    expect(Array.isArray(body.breakdown)).toBe(true);
    expect(body.total.total_usd).toBe(0);
  });

  it("returns 400 for invalid period", async () => {
    const db  = new BetterSqlite3(":memory:");
    const app = makeApp();
    registerCostRoutes(app, { db });

    const res = await app.request("/api/v1/costs?period=invalid");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

describe("GET /api/v1/audit", () => {
  it("returns empty entries when table does not exist", async () => {
    const db  = new BetterSqlite3(":memory:");
    const app = makeApp();
    registerAuditRoutes(app, { db });

    const res  = await app.request("/api/v1/audit");
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: unknown[]; total: number };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.total).toBe(0);
  });

  it("rejects unknown filter columns with 400 (SQL injection whitelist)", async () => {
    const db  = new BetterSqlite3(":memory:");
    const app = makeApp();
    registerAuditRoutes(app, { db });

    const res = await app.request("/api/v1/audit?evil_column=test");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Invalid filter parameter");
  });

  it("accepts known filter params without error (200)", async () => {
    const db  = new BetterSqlite3(":memory:");
    const app = makeApp();
    registerAuditRoutes(app, { db });

    // All known params — no table yet, so returns empty
    const res = await app.request("/api/v1/audit?division=eng&agent=bot-1&event=task_created&limit=10&offset=0");
    expect(res.status).toBe(200);
  });

  it("handles parameterized values safely (no SQL injection via values)", async () => {
    const db  = new BetterSqlite3(":memory:");
    const app = makeApp();
    registerAuditRoutes(app, { db });

    // Injection attempt in a VALUE (not column name) — parameterized query makes this safe
    const res = await app.request("/api/v1/audit?division=test'+OR+'1'%3D'1");
    expect(res.status).toBe(200); // parameterized query handles this safely
    const body = await res.json() as { entries: unknown[]; total: number };
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

describe("GET /api/v1/governance/history", () => {
  it("returns empty snapshot list for a fresh workDir", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir }      = await import("node:os");
    const workDir = mkdtempSync(`${tmpdir()}/sidjua-gov-test-`);

    const app = makeApp();
    registerGovernanceRoutes(app, { workDir, db: null });

    const res  = await app.request("/api/v1/governance/history");
    expect(res.status).toBe(200);
    const body = await res.json() as { snapshots: unknown[] };
    expect(Array.isArray(body.snapshots)).toBe(true);
    expect(body.snapshots).toHaveLength(0);
  });
});

describe("GET /api/v1/governance/status", () => {
  it("returns governance status", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir }      = await import("node:os");
    const workDir = mkdtempSync(`${tmpdir()}/sidjua-gov-test-`);

    const app = makeApp();
    registerGovernanceRoutes(app, { workDir, db: null });

    const res  = await app.request("/api/v1/governance/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { snapshot_count: number };
    expect(typeof body.snapshot_count).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe("GET /api/v1/logging/status", () => {
  it("returns current log level status", async () => {
    const app = makeApp();
    registerLoggingRoutes(app);

    const res  = await app.request("/api/v1/logging/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { global: string; components: Record<string, string> };
    expect(typeof body.global).toBe("string");
    expect(typeof body.components).toBe("object");
  });
});

describe("PUT /api/v1/logging/:component", () => {
  it("changes component log level and returns updated info", async () => {
    const app = makeApp();
    registerLoggingRoutes(app);

    const res = await app.request("/api/v1/logging/api-server", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ level: "debug" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { component: string; level: string; updated: boolean };
    expect(body.component).toBe("api-server");
    expect(body.level).toBe("debug");
    expect(body.updated).toBe(true);
  });

  it("returns 400 for invalid log level", async () => {
    const app = makeApp();
    registerLoggingRoutes(app);

    const res = await app.request("/api/v1/logging/api-server", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ level: "verbose" }),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

describe("GET /api/v1/orchestrator/status", () => {
  it("returns STOPPED state when orchestrator is null", async () => {
    const app = makeApp();
    registerOrchestratorRoutes(app, { orchestrator: null });

    const res  = await app.request("/api/v1/orchestrator/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { state: string };
    expect(body.state).toBe("STOPPED");
  });

  it("returns orchestrator status from mock", async () => {
    const mockOrch = {
      state: "RUNNING" as const,
      pause:     vi.fn(),
      resume:    vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        state: "RUNNING",
        started_at: new Date().toISOString(),
        agents: [],
        pending_task_count: 0,
        total_events_processed: 42,
      }),
    };

    const app = makeApp();
    registerOrchestratorRoutes(app, { orchestrator: mockOrch });

    const res  = await app.request("/api/v1/orchestrator/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { state: string; total_events_processed: number };
    expect(body.state).toBe("RUNNING");
    expect(body.total_events_processed).toBe(42);
  });
});
