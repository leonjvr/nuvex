/**
 * Phase 13c: Execution REST endpoint tests
 *
 * Uses in-memory SQLite + real TaskStore. No HTTP server — calls app.request() directly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono }                    from "hono";
import BetterSqlite3               from "better-sqlite3";
import { registerExecutionRoutes } from "../../../src/api/routes/execution.js";
import { TaskStore }               from "../../../src/tasks/store.js";
import { TaskEventBus }            from "../../../src/tasks/event-bus.js";
import { createErrorHandler }      from "../../../src/api/middleware/error-handler.js";
import { PHASE9_SCHEMA_SQL }       from "../../../src/orchestrator/types.js";
import { withAdminCtx }            from "../../helpers/with-admin-ctx.js";

type Db = InstanceType<typeof BetterSqlite3>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  const store = new TaskStore(db);
  store.initialize();
  const bus = new TaskEventBus(db);
  bus.initialize();
  return db;
}

function makeApp(db: Db): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  registerExecutionRoutes(app, { db });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/tasks/run", () => {
  it("creates and returns a TaskHandle with 201 status", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res = await app.request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        description:  "Write a user authentication service",
        division:     "engineering",
        budget_usd:   1.0,
        priority:     5,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { task_id: string; status: string; assigned_tier: number };
    expect(body.task_id).toBeTruthy();
    expect(body.status).toBe("CREATED");
    expect(body.assigned_tier).toBe(1);
  });

  it("returns 400 when description is empty", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res = await app.request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/tasks/:id/status", () => {
  it("returns correct status for a task with sub-tasks", async () => {
    const db    = makeDb();
    const app   = makeApp(db);
    const store = new TaskStore(db);

    // Create root + child tasks directly
    const root = store.create({
      title: "Root", description: "Root task", division: "eng",
      type: "root", tier: 1, token_budget: 10_000, cost_budget: 1.0,
    });
    store.update(root.id, { status: "RUNNING", token_used: 100, cost_used: 0.01 });

    const child = store.create({
      title: "Child", description: "Child task", division: "eng",
      type: "delegation", tier: 2, parent_id: root.id, root_id: root.id,
      token_budget: 4_000, cost_budget: 0.4,
    });
    store.update(child.id, { status: "DONE", token_used: 50, cost_used: 0.005 });

    const res = await app.request(`/api/v1/tasks/${root.id}/status`);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      task_id: string; status: string; total_sub_tasks: number;
      completed_sub_tasks: number; total_tokens_used: number;
    };
    expect(body.task_id).toBe(root.id);
    expect(body.status).toBe("RUNNING");
    expect(body.total_sub_tasks).toBe(1);
    expect(body.completed_sub_tasks).toBe(1);
    expect(body.total_tokens_used).toBe(150);
  });

  it("returns 404 for unknown task ID", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res = await app.request("/api/v1/tasks/nonexistent-id/status");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/tasks/:id/tree", () => {
  it("returns delegation tree with nested children", async () => {
    const db    = makeDb();
    const app   = makeApp(db);
    const store = new TaskStore(db);

    const root = store.create({
      title: "Root", description: "Root task", division: "eng",
      type: "root", tier: 1, token_budget: 10_000, cost_budget: 1.0,
    });

    const child = store.create({
      title: "Child A", description: "Child task", division: "eng",
      type: "delegation", tier: 2, parent_id: root.id, root_id: root.id,
      token_budget: 4_000, cost_budget: 0.4,
    });
    store.update(child.id, { status: "DONE" });

    const res = await app.request(`/api/v1/tasks/${root.id}/tree`);

    expect(res.status).toBe(200);
    const body = await res.json() as { task_id: string; children: { task_id: string }[] };
    expect(body.task_id).toBe(root.id);
    expect(body.children).toHaveLength(1);
    expect(body.children[0]!.task_id).toBe(child.id);
  });
});
