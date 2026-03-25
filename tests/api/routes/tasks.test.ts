/**
 * Phase 11b: Task route handler tests
 *
 * Uses in-memory SQLite + real TaskStore for realistic testing.
 * No HTTP server — calls app.request() directly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import BetterSqlite3 from "better-sqlite3";
import { registerTaskRoutes }  from "../../../src/api/routes/tasks.js";
import { TaskStore }            from "../../../src/tasks/store.js";
import { createErrorHandler }   from "../../../src/api/middleware/error-handler.js";
import type { CreateTaskInput } from "../../../src/tasks/types.js";
import { withAdminCtx }         from "../../helpers/with-admin-ctx.js";

type Db = InstanceType<typeof BetterSqlite3>;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeApp(db: Db): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  registerTaskRoutes(app, { db });
  return app;
}

function makeDb(): Db {
  const db    = new BetterSqlite3(":memory:");
  const store = new TaskStore(db);
  store.initialize();
  return db;
}

function sampleInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title:        "Sample Task",
    description:  "Do something useful",
    division:     "engineering",
    type:         "root",
    tier:         1,
    token_budget: 10_000,
    cost_budget:  1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/tasks", () => {
  it("creates a task and returns 201 with task object", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res  = await app.request("/api/v1/tasks", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "Write unit tests", division: "engineering" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { task: { id: string; description: string } };
    expect(body.task).toBeDefined();
    expect(body.task.id).toBeTruthy();
    expect(body.task.description).toBe("Write unit tests");
  });

  it("returns 400 when description is missing", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res = await app.request("/api/v1/tasks", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ division: "engineering" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("TASK-001");
  });
});

describe("GET /api/v1/tasks", () => {
  it("returns tasks with pagination metadata", async () => {
    const db    = makeDb();
    const store = new TaskStore(db);
    store.initialize();
    store.create(sampleInput());
    store.create(sampleInput({ title: "Task 2" }));

    const app = makeApp(db);
    const res = await app.request("/api/v1/tasks");

    expect(res.status).toBe(200);
    const body = await res.json() as { tasks: unknown[]; total: number; limit: number; offset: number };
    expect(body.tasks).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("filters by status query param", async () => {
    const db    = makeDb();
    const store = new TaskStore(db);
    store.initialize();
    const t = store.create(sampleInput());
    store.update(t.id, { status: "DONE" });
    store.create(sampleInput({ title: "Task 2" }));

    const app = makeApp(db);
    const res = await app.request("/api/v1/tasks?status=DONE");

    expect(res.status).toBe(200);
    const body = await res.json() as { tasks: unknown[]; total: number };
    expect(body.tasks).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});

describe("GET /api/v1/tasks/:id", () => {
  it("returns task with children and parent_chain", async () => {
    const db    = makeDb();
    const store = new TaskStore(db);
    store.initialize();
    const task = store.create(sampleInput());

    const app = makeApp(db);
    const res = await app.request(`/api/v1/tasks/${task.id}`);

    expect(res.status).toBe(200);
    const body = await res.json() as { task: { id: string; children: unknown[]; parent_chain: unknown[] } };
    expect(body.task.id).toBe(task.id);
    expect(Array.isArray(body.task.children)).toBe(true);
    expect(Array.isArray(body.task.parent_chain)).toBe(true);
  });

  it("returns 404 for non-existent task", async () => {
    const app = makeApp(makeDb());
    const res = await app.request("/api/v1/tasks/nonexistent-id");

    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SYS-404");
  });
});

describe("DELETE /api/v1/tasks/:id", () => {
  it("cancels task and returns cancelled count", async () => {
    const db    = makeDb();
    const store = new TaskStore(db);
    store.initialize();
    const task = store.create(sampleInput());

    const app = makeApp(db);
    const res = await app.request(`/api/v1/tasks/${task.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    const body = await res.json() as { cancelled: number };
    expect(body.cancelled).toBe(1);

    // Verify task is actually cancelled in DB
    const updated = store.get(task.id);
    expect(updated?.status).toBe("CANCELLED");
  });
});
