/**
 * Tests for src/cli/commands/logs.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { runLogsCommand } from "../../../src/cli/commands/logs.js";

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
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-logs-test-"));
  dbFile = join(tmpDir, ".system", "sidjua.db");
  mkdirSync(join(tmpDir, ".system"), { recursive: true });

  const db = openDatabase(dbFile);
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  new TaskStore(db).initialize();
  new TaskEventBus(db).initialize();
  db.close();

  captureOutput();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true });
});

const BASE_OPTS = {
  workDir:  "",
  taskId:   undefined as string | undefined,
  agentId:  undefined as string | undefined,
  division: undefined as string | undefined,
  type:     undefined as string | undefined,
  since:    undefined as string | undefined,
  follow:   false,
  limit:    50,
  json:     false,
};

function makeOpts(o: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...o };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runLogsCommand — no database", () => {
  it("returns 1 when DB not found", async () => {
    const code = await runLogsCommand({ ...BASE_OPTS, workDir: "/nonexistent" });
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("runLogsCommand — empty DB", () => {
  it("returns 0 with no entries message", async () => {
    const code = await runLogsCommand(makeOpts());
    expect(code).toBe(0);
    expect(stdout).toContain("No log entries found");
  });

  it("--json returns empty array", async () => {
    await runLogsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});

describe("runLogsCommand — with events", () => {
  beforeEach(() => {
    const db    = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    const store = new TaskStore(db);
    const bus   = new TaskEventBus(db);

    const task  = store.create({
      title: "Test task", description: "desc",
      division: "engineering", type: "root", tier: 2,
      token_budget: 5000, cost_budget: 0.5,
    });

    bus.emitTask({
      event_type:     "TASK_CREATED",
      task_id:        task.id,
      parent_task_id: null,
      agent_from:     null,
      agent_to:       null,
      division:       task.division,
      data:           {},
    });

    db.close();
  });

  it("shows log entries", async () => {
    stdout = "";
    await runLogsCommand(makeOpts());
    expect(stdout).toContain("TASK_CREATED");
  });

  it("--json returns entries array", async () => {
    stdout = "";
    await runLogsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("--limit restricts output count", async () => {
    stdout = "";
    await runLogsCommand(makeOpts({ json: true, limit: 1 }));
    const data = JSON.parse(stdout);
    expect(data.length).toBeLessThanOrEqual(1);
  });
});
