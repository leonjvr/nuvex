/**
 * Tests for src/cli/commands/tasks.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { runTasksCommand } from "../../../src/cli/commands/tasks.js";

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

function makeStore(): TaskStore {
  const db = openDatabase(dbFile);
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  const store = new TaskStore(db);
  store.initialize();
  db.close();
  return store;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-tasks-test-"));
  dbFile = join(tmpDir, ".system", "sidjua.db");
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
  makeStore();
  captureOutput();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true });
});

const BASE_OPTS = {
  workDir:  "",
  taskId:   undefined as string | undefined,
  status:   "active",
  division: undefined as string | undefined,
  agent:    undefined as string | undefined,
  tier:     undefined as number | undefined,
  limit:    20,
  json:     false,
  summary:  false,
  result:   false,
  tree:     false,
};

function makeOpts(overrides: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runTasksCommand — no database", () => {
  it("returns 1 when DB not found", async () => {
    const code = await runTasksCommand(makeOpts({ workDir: "/nonexistent" }));
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("runTasksCommand — list mode (empty)", () => {
  it("returns 0 with no tasks", async () => {
    const code = await runTasksCommand(makeOpts());
    expect(code).toBe(0);
    expect(stdout).toContain("No tasks found");
  });

  it("--json returns empty array for no tasks", async () => {
    await runTasksCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});

describe("runTasksCommand — list mode (with tasks)", () => {
  let taskId: string;

  beforeEach(() => {
    const db    = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    const store = new TaskStore(db);
    const task  = store.create({
      title: "My test task", description: "desc",
      division: "engineering", type: "root", tier: 2,
      token_budget: 5000, cost_budget: 0.5,
    });
    taskId = task.id;
    db.close();
  });

  it("shows created task in list", async () => {
    await runTasksCommand(makeOpts({ status: "all" }));
    expect(stdout).toContain("My test task");
  });

  it("--json includes task data", async () => {
    await runTasksCommand(makeOpts({ status: "all", json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((t: { id: string }) => t.id === taskId)).toBe(true);
  });

  it("filters by status", async () => {
    // Default filter "active" should catch CREATED tasks
    await runTasksCommand(makeOpts());
    expect(stdout).toContain("My test task");
  });

  it("status=done shows nothing when task is CREATED", async () => {
    await runTasksCommand(makeOpts({ status: "done" }));
    expect(stdout).toContain("No tasks found");
  });
});

describe("runTasksCommand — detail mode", () => {
  let taskId: string;

  beforeEach(() => {
    const db    = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    const store = new TaskStore(db);
    const task  = store.create({
      title: "Detail task", description: "A detailed task",
      division: "general", type: "root", tier: 1,
      token_budget: 10000, cost_budget: 1.0,
    });
    taskId = task.id;
    db.close();
  });

  it("shows task detail for known ID", async () => {
    const code = await runTasksCommand(makeOpts({ taskId }));
    expect(code).toBe(0);
    expect(stdout).toContain("Detail task");
    expect(stdout).toContain("general");
  });

  it("returns 1 for unknown task ID", async () => {
    const code = await runTasksCommand(makeOpts({ taskId: "nonexistent-id" }));
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });

  it("--json returns task and children", async () => {
    await runTasksCommand(makeOpts({ taskId, json: true }));
    const data = JSON.parse(stdout);
    expect(data.task.id).toBe(taskId);
    expect(Array.isArray(data.children)).toBe(true);
  });

  it("--summary returns 1 when no summary available", async () => {
    const code = await runTasksCommand(makeOpts({ taskId, summary: true }));
    expect(code).toBe(1);
    expect(stderr).toContain("No summary available");
  });

  it("--result returns 1 when no result file", async () => {
    const code = await runTasksCommand(makeOpts({ taskId, result: true }));
    expect(code).toBe(1);
    expect(stderr).toContain("No result file");
  });
});
