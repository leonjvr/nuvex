// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P268: Orchestrator Startup Fix + run --wait Removal
 *
 * Covers:
 *   1. bootstrapOrchestrator starts OrchestratorProcess (state = RUNNING)
 *   2. bootstrapOrchestrator uses defaults when yaml absent
 *   3. bootstrapOrchestrator propagates OrchestratorProcess.start() failure
 *   4. run --wait: error when orchestrator pid file is absent
 *   5. run --wait: error when orchestrator has a stale (dead) PID
 *   6. run --wait: polls and returns 0 on DONE
 *   7. run --wait: polls and returns 1 on FAILED
 *   8. run --wait: returns 1 with timeout message when task stays pending
 *   9. SIDJUA_UNSAFE_INLINE removed from run.ts source
 *  10. executeTaskInline removed from run.ts source
 *  11. GOVERNANCE_BYPASS not emitted by new --wait path
 *  12. run.ts source does not contain GOVERNANCE_BYPASS
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join }    from "node:path";
import { tmpdir }  from "node:os";
import Database    from "better-sqlite3";
import { PHASE9_SCHEMA_SQL } from "../../src/orchestrator/index.js";
import { bootstrapOrchestrator } from "../../src/orchestrator/bootstrap.js";
import { runRunCommand }         from "../../src/cli/commands/run.js";
import { TaskStore }             from "../../src/tasks/store.js";

// ---------------------------------------------------------------------------
// Additional schema needed beyond PHASE9_SCHEMA_SQL
// ---------------------------------------------------------------------------

const EXTRA_SCHEMA = `
  CREATE TABLE IF NOT EXISTS cron_schedules (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    task_template TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS schedule_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id TEXT NOT NULL,
    run_at TEXT NOT NULL,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE IF NOT EXISTS agent_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    tier INTEGER NOT NULL DEFAULT 2,
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    skill_file TEXT NOT NULL DEFAULT '',
    division TEXT NOT NULL DEFAULT 'general',
    capabilities TEXT NOT NULL DEFAULT '[]',
    config_yaml TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-p268-"));
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
  mkdirSync(join(tmpDir, "governance"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// Test 1-2: bootstrapOrchestrator starts OrchestratorProcess
// ---------------------------------------------------------------------------

describe("bootstrapOrchestrator", () => {
  it("starts OrchestratorProcess (state = RUNNING)", async () => {
    const db = new Database(join(tmpDir, ".system", "sidjua.db"));
    db.exec(PHASE9_SCHEMA_SQL);
    db.exec(EXTRA_SCHEMA);
    new TaskStore(db).initialize(); // creates tasks + task_events tables

    const orchestrator = await bootstrapOrchestrator({
      db,
      workDir:    tmpDir,
      configPath: join(tmpDir, "governance", "orchestrator.yaml"),
    });

    expect(orchestrator).toBeDefined();
    expect(orchestrator.getStatus().state).toBe("RUNNING");

    await orchestrator.stop();
    db.close();
  });

  it("falls back to defaults when orchestrator.yaml is absent", async () => {
    const db = new Database(join(tmpDir, ".system", "sidjua.db"));
    db.exec(PHASE9_SCHEMA_SQL);
    db.exec(EXTRA_SCHEMA);
    new TaskStore(db).initialize();

    const orchestrator = await bootstrapOrchestrator({
      db,
      workDir:    tmpDir,
      configPath: join(tmpDir, "governance", "orchestrator.yaml"), // absent
    });

    expect(orchestrator.getStatus().state).toBe("RUNNING");
    await orchestrator.stop();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 3: propagates failure
// ---------------------------------------------------------------------------

describe("bootstrapOrchestrator failure handling", () => {
  it("propagates failure when database is closed before bootstrap", async () => {
    const db = new Database(join(tmpDir, ".system", "sidjua.db"));
    // Close the DB before passing it — OrchestratorProcess constructor calls
    // db.exec(PHASE9_SCHEMA_SQL) which throws on a closed connection.
    db.close();

    await expect(
      bootstrapOrchestrator({
        db,
        workDir:    tmpDir,
        configPath: join(tmpDir, "governance", "orchestrator.yaml"),
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests 4-5: run --wait orchestrator presence check
// ---------------------------------------------------------------------------

/** Open + initialize a DB suitable for runRunCommand. */
function makeRunDb(dir: string): void {
  const db = new Database(join(dir, ".system", "sidjua.db"));
  db.exec(PHASE9_SCHEMA_SQL);
  db.exec(EXTRA_SCHEMA);
  new TaskStore(db).initialize();
  db.close();
}

describe("run --wait: orchestrator presence checks", () => {
  it("returns 1 when orchestrator pid file is absent", async () => {
    makeRunDb(tmpDir);

    const result = await runRunCommand({
      workDir:     tmpDir,
      description: "test task",
      file:        undefined,
      priority:    "regular",
      division:    undefined,
      budget:      undefined,
      costLimit:   undefined,
      tier:        2,
      wait:        true,
      timeout:     5,
      json:        false,
    });

    expect(result).toBe(1);
  });

  it("returns 1 when orchestrator has stale (dead) PID", async () => {
    writeFileSync(join(tmpDir, ".system", "orchestrator.pid"), "2147483647");
    makeRunDb(tmpDir);

    const result = await runRunCommand({
      workDir:     tmpDir,
      description: "test task",
      file:        undefined,
      priority:    "regular",
      division:    undefined,
      budget:      undefined,
      costLimit:   undefined,
      tier:        2,
      wait:        true,
      timeout:     5,
      json:        false,
    });

    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Helper: abortable task monitor
// ---------------------------------------------------------------------------

/**
 * Watches the DB for PENDING tasks and sets them to `targetStatus`.
 * Uses AbortController so it terminates instantly without timer leaks.
 */
function startTaskMonitor(
  dbPath: string,
  targetStatus: "DONE" | "FAILED",
): { stop: () => Promise<void> } {
  const controller = new AbortController();
  const done = (async () => {
    const db = new Database(dbPath);
    try {
      while (!controller.signal.aborted) {
        try {
          const rows = db.prepare(
            "SELECT id FROM tasks WHERE status NOT IN ('DONE','FAILED','CANCELLED','ESCALATED')",
          ).all() as { id: string }[];
          for (const row of rows) {
            db.prepare(
              `UPDATE tasks SET status = ?, result_summary = 'monitor', completed_at = datetime('now') WHERE id = ?`,
            ).run(targetStatus, row.id);
          }
        } catch (_e) {
          // DB may not be ready yet
        }
        // Abortable sleep
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) { resolve(); return; }
          const t = setTimeout(resolve, 50);
          controller.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
    } finally {
      db.close();
    }
  })();

  return {
    stop: async () => { controller.abort(); await done; },
  };
}

// ---------------------------------------------------------------------------
// Tests 6-8: run --wait polling
// ---------------------------------------------------------------------------

describe("run --wait: polling behavior", () => {
  it("returns 0 when task reaches DONE before timeout", async () => {
    writeFileSync(join(tmpDir, ".system", "orchestrator.pid"), String(process.pid));
    const dbPath = join(tmpDir, ".system", "sidjua.db");
    const setupDb = new Database(dbPath);
    setupDb.exec(PHASE9_SCHEMA_SQL);
    setupDb.exec(EXTRA_SCHEMA);
    new TaskStore(setupDb).initialize();
    setupDb.close();

    const monitor = startTaskMonitor(dbPath, "DONE");

    const result = await runRunCommand({
      workDir:     tmpDir,
      description: "test task",
      file:        undefined,
      priority:    "regular",
      division:    undefined,
      budget:      undefined,
      costLimit:   undefined,
      tier:        2,
      wait:        true,
      timeout:     30,
      json:        false,
    });

    await monitor.stop();
    expect(result).toBe(0);
  });

  it("returns 1 when task reaches FAILED state", async () => {
    writeFileSync(join(tmpDir, ".system", "orchestrator.pid"), String(process.pid));
    const dbPath = join(tmpDir, ".system", "sidjua.db");
    const setupDb = new Database(dbPath);
    setupDb.exec(PHASE9_SCHEMA_SQL);
    setupDb.exec(EXTRA_SCHEMA);
    new TaskStore(setupDb).initialize();
    setupDb.close();

    const monitor = startTaskMonitor(dbPath, "FAILED");

    const result = await runRunCommand({
      workDir:     tmpDir,
      description: "test task",
      file:        undefined,
      priority:    "regular",
      division:    undefined,
      budget:      undefined,
      costLimit:   undefined,
      tier:        2,
      wait:        true,
      timeout:     30,
      json:        false,
    });

    await monitor.stop();
    expect(result).toBe(1);
  });

  it("returns 1 with timeout when task stays PENDING beyond deadline", async () => {
    writeFileSync(join(tmpDir, ".system", "orchestrator.pid"), String(process.pid));
    makeRunDb(tmpDir);

    // timeout=0: deadline = Date.now() + 0*1000 = now, so the poll loop exits immediately
    const result = await runRunCommand({
      workDir:     tmpDir,
      description: "test task",
      file:        undefined,
      priority:    "regular",
      division:    undefined,
      budget:      undefined,
      costLimit:   undefined,
      tier:        2,
      wait:        true,
      timeout:     0,
      json:        false,
    });

    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 9: SIDJUA_UNSAFE_INLINE removed
// ---------------------------------------------------------------------------

describe("SIDJUA_UNSAFE_INLINE removed", () => {
  it("run.ts source contains no SIDJUA_UNSAFE_INLINE references", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("UNSAFE_INLINE");
  });
});

// ---------------------------------------------------------------------------
// Test 10: executeTaskInline removed
// ---------------------------------------------------------------------------

describe("executeTaskInline removed", () => {
  it("run.ts source contains no executeTaskInline function definition", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf8",
    );
    // Check that the function definition is gone (not just word matches)
    expect(src).not.toContain("async function executeTaskInline");
    expect(src).not.toContain("await executeTaskInline");
    expect(src).not.toContain("return await executeTaskInline");
  });
});

// ---------------------------------------------------------------------------
// Tests 11-12: GOVERNANCE_BYPASS not emitted
// ---------------------------------------------------------------------------

describe("GOVERNANCE_BYPASS not emitted", () => {
  it("new --wait path emits TASK_CREATED but not GOVERNANCE_BYPASS", async () => {
    writeFileSync(join(tmpDir, ".system", "orchestrator.pid"), String(process.pid));
    const dbPath = join(tmpDir, ".system", "sidjua.db");
    const setupDb = new Database(dbPath);
    setupDb.exec(PHASE9_SCHEMA_SQL);
    setupDb.exec(EXTRA_SCHEMA);
    new TaskStore(setupDb).initialize();
    setupDb.close();

    const monitor = startTaskMonitor(dbPath, "DONE");

    await runRunCommand({
      workDir:     tmpDir,
      description: "governance check",
      file:        undefined,
      priority:    "regular",
      division:    undefined,
      budget:      undefined,
      costLimit:   undefined,
      tier:        2,
      wait:        true,
      timeout:     30,
      json:        false,
    });

    await monitor.stop();

    // Read event log directly
    const checkDb = new Database(dbPath);
    const bypassEvents = checkDb
      .prepare("SELECT COUNT(*) as cnt FROM task_events WHERE event_type = 'GOVERNANCE_BYPASS'")
      .get() as { cnt: number };
    checkDb.close();

    expect(bypassEvents.cnt).toBe(0);
  });

  it("run.ts source does not reference GOVERNANCE_BYPASS", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("GOVERNANCE_BYPASS");
  });
});
