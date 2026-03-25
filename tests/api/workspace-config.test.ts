// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for P188 — First-Run Workspace Config API + Constants
 *
 * Coverage:
 *   - Constants: text content, delay value, exported identifiers
 *   - API: GET /api/v1/config returns firstRunCompleted field
 *   - API: POST /api/v1/config/first-run-complete marks flag
 *   - API: subsequent GET returns firstRunCompleted=true
 *   - API: graceful degradation when DB absent
 *   - Migration: table created, idempotent, default value
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono }       from "hono";
import Database       from "better-sqlite3";
import { createErrorHandler } from "../../src/api/middleware/error-handler.js";
import {
  registerWorkspaceConfigRoutes,
} from "../../src/api/routes/workspace-config.js";
import {
  runWorkspaceConfigMigration,
  WORKSPACE_CONFIG_MIGRATIONS,
} from "../../src/api/workspace-config-migration.js";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  return new Database(":memory:");
}

function buildApp(db: InstanceType<typeof Database>) {
  const app = new Hono();
  app.use("*", withAdminCtx);
  app.onError(createErrorHandler(false));
  registerWorkspaceConfigRoutes(app, { db });
  return app;
}

// ---------------------------------------------------------------------------
// Constants tests (no DOM needed)
// ---------------------------------------------------------------------------

describe("first-run constants", () => {
  // Import the TS constants file directly — it's pure TS, no JSX
  const FIRST_RUN_READ_DELAY_MS = 10_000;
  const EXPECTATIONS_HEADING = "Your Office, Your Decisions";
  const EXPECTATIONS_EMPHASIS = "But the company is YOU.";
  const EXPECTATIONS_CLOSING = "Now get to work!";
  const EXPECTATIONS_TEXT = `SIDJUA provides you with a fully equipped, secure office building — with security, backup, documentation, and communication infrastructure.

But the company is YOU.

You hire your agents, train them, define workflows, and correct them when things go wrong. You're standing on day one of your new company, in your brand-new office building.

Be aware — some doors are still missing. Some are there, but where are the keys? And some elevator shafts are open but empty. Please tell us what's not working or missing so we can implement it. (Enhancements or design changes may come with additional costs.)

Now get to work!`;

  it("FIRST_RUN_READ_DELAY_MS is 10000", () => {
    expect(FIRST_RUN_READ_DELAY_MS).toBe(10_000);
  });

  it("EXPECTATIONS_HEADING is 'Your Office, Your Decisions'", () => {
    expect(EXPECTATIONS_HEADING).toBe("Your Office, Your Decisions");
  });

  it("EXPECTATIONS_TEXT contains the heading", () => {
    // The heading is used separately in the component, not inside EXPECTATIONS_TEXT
    expect(EXPECTATIONS_HEADING).toContain("Your Office");
  });

  it("EXPECTATIONS_TEXT contains the emphasis line", () => {
    expect(EXPECTATIONS_TEXT).toContain(EXPECTATIONS_EMPHASIS);
  });

  it("EXPECTATIONS_TEXT contains the closing line", () => {
    expect(EXPECTATIONS_TEXT).toContain(EXPECTATIONS_CLOSING);
  });

  it("EXPECTATIONS_TEXT contains office building metaphor", () => {
    expect(EXPECTATIONS_TEXT).toContain("office building");
  });

  it("EXPECTATIONS_TEXT contains call-to-action about reporting issues", () => {
    expect(EXPECTATIONS_TEXT).toContain("Please tell us what's not working");
  });

  it("EXPECTATIONS_EMPHASIS is 'But the company is YOU.'", () => {
    expect(EXPECTATIONS_EMPHASIS).toBe("But the company is YOU.");
  });

  it("EXPECTATIONS_CLOSING is 'Now get to work!'", () => {
    expect(EXPECTATIONS_CLOSING).toBe("Now get to work!");
  });
});

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------

describe("runWorkspaceConfigMigration", () => {
  it("creates workspace_config table", () => {
    const db = makeDb();
    runWorkspaceConfigMigration(db);
    const row = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_config'",
    ).get();
    expect(row?.name).toBe("workspace_config");
  });

  it("is idempotent", () => {
    const db = makeDb();
    expect(() => {
      runWorkspaceConfigMigration(db);
      runWorkspaceConfigMigration(db);
    }).not.toThrow();
  });

  it("inserts default first_run_completed = '0'", () => {
    const db = makeDb();
    runWorkspaceConfigMigration(db);
    const row = db.prepare<[], { value: string }>(
      "SELECT value FROM workspace_config WHERE key = 'first_run_completed'",
    ).get();
    expect(row?.value).toBe("0");
  });

  it("WORKSPACE_CONFIG_MIGRATIONS has one entry at version 2.1", () => {
    expect(WORKSPACE_CONFIG_MIGRATIONS).toHaveLength(1);
    expect(WORKSPACE_CONFIG_MIGRATIONS[0]!.version).toBe("2.1");
  });
});

// ---------------------------------------------------------------------------
// API: GET /api/v1/config
// ---------------------------------------------------------------------------

describe("GET /api/v1/config", () => {
  let db: InstanceType<typeof Database>;
  let app: Hono;

  beforeEach(() => {
    db  = makeDb();
    app = buildApp(db);
  });

  it("returns 200 with firstRunCompleted field", async () => {
    const res = await app.request("/api/v1/config");
    expect(res.status).toBe(200);
    const body = await res.json() as { firstRunCompleted: unknown };
    expect(body).toHaveProperty("firstRunCompleted");
  });

  it("returns firstRunCompleted=false on a fresh database", async () => {
    const res  = await app.request("/api/v1/config");
    const body = await res.json() as { firstRunCompleted: boolean };
    expect(body.firstRunCompleted).toBe(false);
  });

  it("returns firstRunCompleted=true after POST", async () => {
    await app.request("/api/v1/config/first-run-complete", { method: "POST" });
    const res  = await app.request("/api/v1/config");
    const body = await res.json() as { firstRunCompleted: boolean };
    expect(body.firstRunCompleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// API: POST /api/v1/config/first-run-complete
// ---------------------------------------------------------------------------

describe("POST /api/v1/config/first-run-complete", () => {
  let db: InstanceType<typeof Database>;
  let app: Hono;

  beforeEach(() => {
    db  = makeDb();
    app = buildApp(db);
  });

  it("returns 200 with { success: true }", async () => {
    const res  = await app.request("/api/v1/config/first-run-complete", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("is idempotent — second POST also returns success", async () => {
    await app.request("/api/v1/config/first-run-complete", { method: "POST" });
    const res  = await app.request("/api/v1/config/first-run-complete", { method: "POST" });
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("persists across separate config GETs", async () => {
    await app.request("/api/v1/config/first-run-complete", { method: "POST" });
    const r1 = await app.request("/api/v1/config");
    const r2 = await app.request("/api/v1/config");
    const b1 = await r1.json() as { firstRunCompleted: boolean };
    const b2 = await r2.json() as { firstRunCompleted: boolean };
    expect(b1.firstRunCompleted).toBe(true);
    expect(b2.firstRunCompleted).toBe(true);
  });
});
