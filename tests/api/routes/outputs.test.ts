/**
 * Phase 14: Output route handler tests
 *
 * Uses in-memory SQLite. No HTTP server — calls app.request() directly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import BetterSqlite3 from "better-sqlite3";
import { registerOutputRoutes }  from "../../../src/api/routes/outputs.js";
import { TaskOutputStore }       from "../../../src/tasks/output-store.js";
import { TaskSummaryStore }      from "../../../src/tasks/summary-store.js";
import { TaskOutputEmbedder }    from "../../../src/tasks/output-embedder.js";
import { createErrorHandler }    from "../../../src/api/middleware/error-handler.js";
import { withAdminCtx }          from "../../helpers/with-admin-ctx.js";

type Db = InstanceType<typeof BetterSqlite3>;

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  const os = new TaskOutputStore(db);
  const ss = new TaskSummaryStore(db);
  const emb = new TaskOutputEmbedder(db, null);
  os.initialize();
  ss.initialize();
  emb.initialize();
  return db;
}

function makeApp(db: Db): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  registerOutputRoutes(app, { db });
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/v1/tasks/:taskId/outputs
// ---------------------------------------------------------------------------

describe("GET /api/v1/tasks/:taskId/outputs", () => {
  it("returns empty list when no outputs exist", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res  = await app.request("/api/v1/tasks/task-001/outputs");
    const body = await res.json() as { outputs: unknown[]; total: number };

    expect(res.status).toBe(200);
    expect(body.outputs).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns list when outputs exist", async () => {
    const db   = makeDb();
    const app  = makeApp(db);
    const store = new TaskOutputStore(db);

    store.create({ task_id: "task-002", agent_id: "a", output_type: "report", content_text: "hello" });

    const res  = await app.request("/api/v1/tasks/task-002/outputs");
    const body = await res.json() as { outputs: unknown[]; total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect((body.outputs[0] as { output_type: string }).output_type).toBe("report");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/outputs/:id
// ---------------------------------------------------------------------------

describe("GET /api/v1/outputs/:id", () => {
  it("returns specific output by id", async () => {
    const db    = makeDb();
    const app   = makeApp(db);
    const store = new TaskOutputStore(db);
    const o     = store.create({ task_id: "t", agent_id: "a", output_type: "code", content_text: "x=1" });

    const res  = await app.request(`/api/v1/outputs/${o.id}`);
    const body = await res.json() as { id: string; output_type: string };

    expect(res.status).toBe(200);
    expect(body.id).toBe(o.id);
    expect(body.output_type).toBe("code");
  });

  it("returns 500 for non-existent output (SidjuaError OUTPUT-002 maps to error handler)", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res = await app.request("/api/v1/outputs/nonexistent-id");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/outputs/search
// ---------------------------------------------------------------------------

describe("GET /api/v1/outputs/search", () => {
  it("returns results for a query", async () => {
    const db    = makeDb();
    const app   = makeApp(db);
    const store = new TaskOutputStore(db);
    store.create({ task_id: "t", agent_id: "a", output_type: "report", content_text: "budget analysis" });

    const res  = await app.request("/api/v1/outputs/search?q=budget");
    const body = await res.json() as { results: unknown[] };

    expect(res.status).toBe(200);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("returns 400 when q is missing", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res = await app.request("/api/v1/outputs/search");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/outputs/stats
// ---------------------------------------------------------------------------

describe("GET /api/v1/outputs/stats", () => {
  it("returns statistics object", async () => {
    const db  = makeDb();
    const app = makeApp(db);

    const res  = await app.request("/api/v1/outputs/stats");
    const body = await res.json() as {
      total_outputs: number;
      total_summaries: number;
    };

    expect(res.status).toBe(200);
    expect(typeof body.total_outputs).toBe("number");
    expect(typeof body.total_summaries).toBe("number");
  });
});
