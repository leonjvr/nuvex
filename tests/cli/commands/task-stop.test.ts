/**
 * Tests for src/cli/commands/task-stop.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { runTaskStopCommand } from "../../../src/cli/commands/task-stop.js";

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

let stdout = "";
let stderr = "";

function captureOutput(): void {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout += String(c); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => { stderr += String(c); return true; });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let dbFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-task-stop-test-"));
  dbFile = join(tmpDir, ".system", "sidjua.db");
  mkdirSync(join(tmpDir, ".system"), { recursive: true });

  const db = openDatabase(dbFile);
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  new TaskStore(db).initialize();
  db.close();

  captureOutput();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true });
});

const BASE_OPTS = {
  workDir: "",
  taskId:  "",
  force:   true,     // skip confirmation prompt in tests
  reason:  "test_cancel",
  json:    false,
};

function makeOpts(o: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...o };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runTaskStopCommand — no database", () => {
  it("returns 1 when DB not found", async () => {
    const code = await runTaskStopCommand({ ...BASE_OPTS, workDir: "/nonexistent", taskId: "x" });
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("runTaskStopCommand — task not found", () => {
  it("returns 1 for unknown task", async () => {
    const code = await runTaskStopCommand(makeOpts({ taskId: "no-such-task" }));
    expect(code).toBe(1);
    expect(stderr).toContain("Task not found");
  });
});

describe("runTaskStopCommand — cancels task", () => {
  let taskId: string;

  beforeEach(() => {
    const db    = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    const store = new TaskStore(db);
    const task  = store.create({
      title: "To cancel", description: "desc",
      division: "engineering", type: "root", tier: 2,
      token_budget: 5000, cost_budget: 0.5,
    });
    taskId = task.id;
    db.close();
  });

  it("cancels a task with --force", async () => {
    const code = await runTaskStopCommand(makeOpts({ taskId, force: true }));
    expect(code).toBe(0);
    expect(stdout).toContain("Cancelled");
  });

  it("--json returns cancellation result", async () => {
    stdout = "";
    await runTaskStopCommand(makeOpts({ taskId, force: true, json: true }));
    // Logger writes compact single-line JSON; command writes pretty-printed JSON.
    // The command output starts with "{\n" — take everything from the last such position.
    const cmdStart = stdout.lastIndexOf("{\n");
    expect(cmdStart).toBeGreaterThanOrEqual(0);
    const data = JSON.parse(stdout.slice(cmdStart).trim());
    expect(typeof data.cancelled_count).toBe("number");
    expect(Array.isArray(data.tasks_cancelled)).toBe(true);
  });
});
