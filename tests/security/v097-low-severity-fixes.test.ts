// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * v0.9.7 Security Sprint — LOW Severity Fixes
 *
 * FIX-457: Replace full-table-scan fallback in communication-manager.ts with FTS5
 * FIX-464: Record tool execution costs to cost_ledger; add cost_type column migration
 * FIX-471: Dead/stub code cleanup (4 sub-items)
 *   3a. embedding-config persist provider to config.json
 *   3b. tasks result endpoint reads from task_outputs
 *   3c. agent stub routes return 503 JSON (not throw)
 *   3d. --detach flag prints user-facing message and continues in foreground
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// FIX-457: FTS5-backed TaskOutputStore.searchText()
// ---------------------------------------------------------------------------

describe("FIX-457: TaskOutputStore.searchText() FTS5 search", () => {
  let db: InstanceType<typeof Database>;
  let store: import("../../src/tasks/output-store.js").TaskOutputStore;

  beforeEach(async () => {
    const { TaskOutputStore } = await import("../../src/tasks/output-store.js");
    db = new Database(":memory:");
    store = new TaskOutputStore(db as unknown as import("../../src/utils/db.js").Database);
    store.initialize();
  });

  it("creates the FTS5 virtual table on initialize()", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_outputs_fts'")
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.name).toBe("task_outputs_fts");
  });

  it("creates INSERT trigger to keep FTS in sync", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='task_outputs_ai'")
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("creates DELETE trigger to keep FTS in sync", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='task_outputs_ad'")
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("creates UPDATE trigger to keep FTS in sync", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='task_outputs_au'")
      .get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("searchText() finds outputs by content_text via FTS5", () => {
    store.create({
      task_id:      "task-1",
      agent_id:     "agent-1",
      output_type:  "report",
      content_text: "quarterly earnings analysis for silicon valley startups",
    });
    store.create({
      task_id:      "task-2",
      agent_id:     "agent-1",
      output_type:  "report",
      content_text: "weather forecast for next week in London",
    });

    const results = store.searchText("earnings");
    expect(results).toHaveLength(1);
    expect(results[0]!.task_id).toBe("task-1");
    expect(results[0]!.content_text).toContain("earnings");
  });

  it("searchText() returns empty array when no match", () => {
    store.create({
      task_id:      "task-1",
      agent_id:     "agent-1",
      output_type:  "report",
      content_text: "completely unrelated content",
    });

    const results = store.searchText("xyznonexistent");
    expect(results).toHaveLength(0);
  });

  it("searchText() respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      store.create({
        task_id:      `task-${i}`,
        agent_id:     "agent-1",
        output_type:  "report",
        content_text: `shared keyword content item ${i}`,
      });
    }

    const results = store.searchText("keyword", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("searchText() falls back to LIKE filter when FTS table absent", () => {
    // Simulate pre-0.9.7 DB without FTS table by dropping it
    db.exec("DROP TABLE IF EXISTS task_outputs_fts");
    db.exec("DROP TRIGGER IF EXISTS task_outputs_ai");
    db.exec("DROP TRIGGER IF EXISTS task_outputs_ad");
    db.exec("DROP TRIGGER IF EXISTS task_outputs_au");

    // Manually insert a row (triggers gone, so FTS won't be populated)
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO task_outputs (id, task_id, agent_id, division_id, output_type,
       filename, mime_type, content_text, content_binary, content_hash,
       classification, metadata, created_at, updated_at)
       VALUES (?,?,?,NULL,'report',NULL,NULL,?,NULL,?,'INTERNAL','{}',?,?)`,
    ).run("out-1", "task-1", "agent-1", "legacy content with fallback", "abc123", now, now);

    const results = store.searchText("fallback");
    expect(results).toHaveLength(1);
    expect(results[0]!.content_text).toContain("fallback");
  });

  it("searchText() returns full TaskOutput objects with all fields", () => {
    store.create({
      task_id:      "task-full",
      agent_id:     "agent-full",
      output_type:  "analysis",
      content_text: "detailed market analysis report",
      classification: "CONFIDENTIAL",
    });

    const results = store.searchText("market");
    expect(results).toHaveLength(1);
    const out = results[0]!;
    expect(out.id).toBeTruthy();
    expect(out.task_id).toBe("task-full");
    expect(out.agent_id).toBe("agent-full");
    expect(out.output_type).toBe("analysis");
    expect(out.classification).toBe("CONFIDENTIAL");
    expect(out.created_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// FIX-457: CommunicationManager uses searchText() not full-table scan
// ---------------------------------------------------------------------------

describe("FIX-457: CommunicationManager uses FTS-backed searchText", () => {
  it("communication-manager.ts does not contain full-table-scan fallback code", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/tasks/communication-manager.ts", "utf-8");

    // Should not contain the old full-table-scan JS filter pattern
    expect(src).not.toContain(".filter((o) =>");
    expect(src).not.toContain("getAllOutputs()");
  });

  it("communication-manager.ts uses outputStore.searchText()", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/tasks/communication-manager.ts", "utf-8");
    expect(src).toContain("searchText(");
  });
});

// ---------------------------------------------------------------------------
// FIX-464: cost_type column in cost_ledger schema + V2 migration
// ---------------------------------------------------------------------------

describe("FIX-464: cost_type column in cost_ledger schema", () => {
  it("V1_INITIAL schema includes cost_type column in cost_ledger", async () => {
    const { MIGRATIONS } = await import("../../src/apply/database.js");
    const v1 = MIGRATIONS[0]!;
    expect(v1.up).toContain("cost_type");
    expect(v1.up).toContain("idx_cost_type");
  });

  it("V2_COST_TYPE migration exists with version 2.0", async () => {
    const { MIGRATIONS } = await import("../../src/apply/database.js");
    // Must have at least 2 migrations
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(2);
    const v2 = MIGRATIONS[1]!;
    expect(v2.version).toBe("2.0");
    expect(v2.description).toContain("cost_type");
  });

  it("applyDatabase conditionally adds cost_type to pre-0.9.7 databases", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/apply/database.ts", "utf-8");
    // Must use PRAGMA table_info guard to avoid duplicate column error
    expect(src).toContain("table_info(cost_ledger)");
    expect(src).toContain("ALTER TABLE cost_ledger ADD COLUMN cost_type");
  });

  it("CostTracker.recordCost() accepts optional costType parameter", async () => {
    const { CostTracker } = await import("../../src/provider/cost-tracker.js");
    const db = new Database(":memory:");

    // Create the tables needed
    db.exec(`
      CREATE TABLE IF NOT EXISTS divisions (code TEXT PRIMARY KEY, name_en TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, required INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO divisions (code, name_en, active, required) VALUES ('engineering', 'Engineering', 1, 0);
      CREATE TABLE IF NOT EXISTS cost_budgets (division_code TEXT PRIMARY KEY, monthly_limit_usd REAL, daily_limit_usd REAL, alert_threshold_percent REAL DEFAULT 80.0);
      INSERT OR IGNORE INTO cost_budgets (division_code) VALUES ('engineering');
      CREATE TABLE IF NOT EXISTS cost_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        division_code TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        task_id TEXT,
        cost_type TEXT NOT NULL DEFAULT 'llm_call'
      );
    `);

    const tracker = new CostTracker(db as unknown as import("../../src/utils/db.js").Database);

    // Record an LLM call (default cost_type)
    tracker.recordCost("engineering", "agent-1", "anthropic", "claude-sonnet-4-6",
      { inputTokens: 100, outputTokens: 50 }, 0.001);

    // Record a tool execution cost
    tracker.recordCost("engineering", "agent-1", "tool", "bash_execute",
      { inputTokens: 0, outputTokens: 0 }, 0.0001, "task-1", "tool_execution");

    const rows = db.prepare("SELECT cost_type FROM cost_ledger ORDER BY id").all() as { cost_type: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cost_type).toBe("llm_call");
    expect(rows[1]!.cost_type).toBe("tool_execution");
  });

  it("AgentReasoningLoop CostRecorder type accepts costType field", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/agents/reasoning-loop.ts", "utf-8");
    expect(src).toContain("costType?:");
    expect(src).toContain("tool_execution");
  });

  it("reasoning-loop.ts records tool execution costs when cost_usd > 0", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/agents/reasoning-loop.ts", "utf-8");
    // Should record tool cost with costType: "tool_execution"
    expect(src).toContain("\"tool_execution\"");
    // Should check toolCostUsd > 0 before recording
    expect(src).toContain("toolCostUsd > 0");
  });
});

// ---------------------------------------------------------------------------
// FIX-471 3a: embedding-config persists provider to config.json
// ---------------------------------------------------------------------------

describe("FIX-471 3a: embedding-config persists provider", () => {
  it("embedding-config.ts calls persistEmbeddingProvider() after successful import", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/cli/commands/embedding-config.ts", "utf-8");
    expect(src).toContain("persistEmbeddingProvider(");
    // Must be called after runImport
    const persistIndex = src.indexOf("persistEmbeddingProvider(");
    const importIndex  = src.indexOf("runImport(");
    expect(persistIndex).toBeGreaterThan(importIndex);
  });

  it("persistEmbeddingProvider() reads + writes config.json with embedding key", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/cli/commands/embedding-config.ts", "utf-8");
    // Must update the 'embedding' key in config
    expect(src).toContain("config[\"embedding\"]");
    expect(src).toContain("provider");
    expect(src).toContain("updated_at");
  });

  it("persistEmbeddingProvider() logs warning on failure (non-fatal)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/cli/commands/embedding-config.ts", "utf-8");
    // Must have warn log on catch (non-fatal)
    expect(src).toContain("embedding_provider_persist_failed");
    // Should NOT re-throw or call process.exit inside the persist function
    const persistFnMatch = src.match(/async function persistEmbeddingProvider[\s\S]+?^}/m);
    if (persistFnMatch) {
      expect(persistFnMatch[0]).not.toContain("process.exit");
      expect(persistFnMatch[0]).not.toContain("throw ");
    }
  });

  it("embedding-config.ts imports readFile and writeFile from node:fs/promises", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/cli/commands/embedding-config.ts", "utf-8");
    expect(src).toContain("readFile");
    expect(src).toContain("writeFile");
    expect(src).toContain("node:fs/promises");
  });
});

// ---------------------------------------------------------------------------
// FIX-471 3b: /api/v1/tasks/:id/result reads from task_outputs table
// ---------------------------------------------------------------------------

describe("FIX-471 3b: task result endpoint reads from task_outputs", () => {
  it("tasks.ts result endpoint queries task_outputs table", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/routes/tasks.ts", "utf-8");
    expect(src).toContain("task_outputs");
    expect(src).toContain("content_text");
  });

  it("tasks.ts result endpoint returns content and mime_type from DB", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/routes/tasks.ts", "utf-8");
    // Returns actual content from DB row
    expect(src).toContain("outputRow?.content_text");
    expect(src).toContain("outputRow?.mime_type");
  });

  it("result endpoint returns actual content from task_outputs", async () => {
    const { registerTaskRoutes } = await import("../../src/api/routes/tasks.js");
    const { createErrorHandler } = await import("../../src/api/middleware/error-handler.js");
    const Database2 = (await import("better-sqlite3")).default;
    const db = new Database2(":memory:");

    // Create both tasks and task_outputs tables
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT, description TEXT, division TEXT, type TEXT,
        tier INTEGER, token_budget INTEGER, cost_budget REAL, priority INTEGER DEFAULT 5,
        ttl_seconds INTEGER, parent_id TEXT, root_id TEXT, assigned_agent TEXT,
        status TEXT DEFAULT 'CREATED', result_summary TEXT, result_file TEXT,
        confidence REAL, metadata TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT,
        completed_at TEXT, cost_used REAL DEFAULT 0
      );
      CREATE TABLE task_outputs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        division_id TEXT, output_type TEXT NOT NULL, filename TEXT, mime_type TEXT,
        content_text TEXT, content_binary BLOB, content_hash TEXT NOT NULL,
        classification TEXT NOT NULL DEFAULT 'INTERNAL', metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (id, title, description, division, type, tier, token_budget,
       cost_budget, status, result_file, metadata, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("task-r1", "Test", "desc", "default", "root", 1, 100000, 10.0,
      "DONE", "/results/task-r1.md", "{}", now, now);

    db.prepare(
      `INSERT INTO task_outputs (id, task_id, agent_id, output_type, mime_type,
       content_text, content_hash, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run("out-1", "task-r1", "agent-1", "report", "text/markdown",
      "# Final Result\n\nThis is the actual content.", "abc123", now, now);

    const app = new Hono();
    app.use("*", withAdminCtx);
    app.onError(createErrorHandler(false));
    registerTaskRoutes(app, { db: db as unknown as import("../../src/utils/db.js").Database });

    const res  = await app.request("/api/v1/tasks/task-r1/result");
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body["content"]).toContain("Final Result");
    expect(body["mime_type"]).toBe("text/markdown");
    expect(body["result_file_path"]).toBe("/results/task-r1.md");
  });

  it("result endpoint returns null content when task_outputs table absent (graceful)", async () => {
    const { registerTaskRoutes } = await import("../../src/api/routes/tasks.js");
    const { createErrorHandler } = await import("../../src/api/middleware/error-handler.js");
    const Database2 = (await import("better-sqlite3")).default;
    const db = new Database2(":memory:");

    // Only create tasks table — task_outputs absent (simulates pre-run state)
    const now = new Date().toISOString();
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT, description TEXT, division TEXT, type TEXT,
        tier INTEGER, token_budget INTEGER, cost_budget REAL, priority INTEGER DEFAULT 5,
        ttl_seconds INTEGER, parent_id TEXT, root_id TEXT, assigned_agent TEXT,
        status TEXT DEFAULT 'CREATED', result_summary TEXT, result_file TEXT,
        confidence REAL, metadata TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT,
        completed_at TEXT, cost_used REAL DEFAULT 0
      );
    `);
    db.prepare(
      `INSERT INTO tasks (id, title, description, division, type, tier, token_budget,
       cost_budget, status, result_file, metadata, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run("task-r2", "Test", "desc", "default", "root", 1, 100000, 10.0,
      "DONE", "/results/task-r2.md", "{}", now, now);

    const app = new Hono();
    app.use("*", withAdminCtx);
    app.onError(createErrorHandler(false));
    registerTaskRoutes(app, { db: db as unknown as import("../../src/utils/db.js").Database });

    const res  = await app.request("/api/v1/tasks/task-r2/result");
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body["content"]).toBeNull();
    // mime_type defaults to text/markdown when no output row
    expect(body["mime_type"]).toBe("text/markdown");
  });
});

// ---------------------------------------------------------------------------
// FIX-471 3c: Agent stub routes return 503 JSON instead of throwing
// ---------------------------------------------------------------------------

describe("FIX-471 3c: agent stub routes return 503 JSON", () => {
  async function makeAppWithoutRegistry() {
    const { registerAllRoutes } = await import("../../src/api/routes/index.js");
    const app = new Hono();
    app.use("*", withAdminCtx);
    // No registry → stub routes registered
    registerAllRoutes(app, { db: null });
    return app;
  }

  it("GET /api/v1/agents returns 503 JSON when registry not configured", async () => {
    const app = await makeAppWithoutRegistry();
    const res  = await app.request("/api/v1/agents");
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    const err = body["error"] as Record<string, unknown>;
    // B3 (#519): generic code — must not leak internal AGT- codes to unauthenticated callers
    expect(err["code"]).toBe("SYS-503");
  });

  it("GET /api/v1/agents/:id returns 503 JSON when registry not configured", async () => {
    const app = await makeAppWithoutRegistry();
    const res  = await app.request("/api/v1/agents/any-agent-id");
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("SYS-503");
  });

  it("POST /api/v1/agents/:id/start returns 503 JSON when registry not configured", async () => {
    const app = await makeAppWithoutRegistry();
    const res  = await app.request("/api/v1/agents/any-id/start", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("SYS-503");
  });

  it("POST /api/v1/agents/:id/stop returns 503 JSON when registry not configured", async () => {
    const app = await makeAppWithoutRegistry();
    const res  = await app.request("/api/v1/agents/any-id/stop", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect((body["error"] as Record<string, unknown>)["code"]).toBe("SYS-503");
  });

  it("503 response body is generic and recoverable (B3 #519)", async () => {
    const app = await makeAppWithoutRegistry();
    const res  = await app.request("/api/v1/agents");
    const body = await res.json() as Record<string, unknown>;
    const err  = body["error"] as Record<string, unknown>;
    // B3 (#519): recoverable=true (transient), generic message (no internal details)
    expect(err["recoverable"]).toBe(true);
    expect(String(err["message"])).toBe("Service temporarily unavailable");
  });

  it("api/routes/index.ts does not import SidjuaError (removed unused import)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/routes/index.ts", "utf-8");
    // SidjuaError should no longer be imported
    expect(src).not.toContain("import { SidjuaError }");
    expect(src).not.toContain("from \"../../core/error-codes.js\"");
  });
});

// ---------------------------------------------------------------------------
// FIX-471 3d: --detach flag prints user-facing message and continues
// ---------------------------------------------------------------------------

describe("FIX-471 3d: --detach flag behaviour", () => {
  it("cli-server.ts start command has --detach option defined", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/cli-server.ts", "utf-8");
    expect(src).toContain("--detach");
  });

  it("--detach option does not exit process — starts server in foreground", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/cli-server.ts", "utf-8");
    // The detach block should write a warning but NOT call process.exit
    const detachBlockMatch = src.match(/if \(opts\.detach\)\s*\{[\s\S]+?\}/);
    expect(detachBlockMatch).toBeTruthy();
    if (detachBlockMatch) {
      // Should NOT exit inside the detach guard
      expect(detachBlockMatch[0]).not.toContain("process.exit");
    }
  });

  it("--detach message mentions process manager alternatives", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/cli-server.ts", "utf-8");
    // Should guide user toward pm2 or systemd
    expect(src).toMatch(/pm2|systemd/);
  });

  it("--detach message says server runs in foreground", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/cli-server.ts", "utf-8");
    expect(src).toContain("foreground");
  });

  it("detach: false is the default option value", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/api/cli-server.ts", "utf-8");
    // Default false so normal invocations are unaffected
    expect(src).toMatch(/[\"']--detach[\"'][\s\S]{0,200}false/);
  });
});
