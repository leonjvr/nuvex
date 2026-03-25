/**
 * Tests for src/cli/commands/decide.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { runDecideCommand } from "../../../src/cli/commands/decide.js";

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
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-decide-test-"));
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
  workDir:    "",
  taskId:     undefined as string | undefined,
  action:     undefined as string | undefined,
  guidance:   undefined as string | undefined,
  agentId:    undefined as string | undefined,
  result:     undefined as string | undefined,
  resultFile: undefined as string | undefined,
  json:       false,
};

function makeOpts(o: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...o };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDecideCommand — no database", () => {
  it("returns 1 when DB not found", async () => {
    const code = await runDecideCommand({ ...BASE_OPTS, workDir: "/nonexistent" });
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("runDecideCommand — list mode (no pending)", () => {
  it("returns 0 with no pending message", async () => {
    const code = await runDecideCommand(makeOpts());
    expect(code).toBe(0);
    expect(stdout).toContain("No pending");
  });

  it("--json returns empty array when no pending", async () => {
    await runDecideCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});

describe("runDecideCommand — list mode (with pending)", () => {
  let taskId: string;

  beforeEach(() => {
    const db    = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    const store = new TaskStore(db);
    const task  = store.create({
      title: "Needs decision", description: "desc",
      division: "general", type: "root", tier: 1,
      token_budget: 10000, cost_budget: 1.0,
    });
    taskId = task.id;

    // Insert a human_decisions row
    db.prepare<unknown[], void>(`
      INSERT INTO human_decisions (task_id, reason, options, created_at)
      VALUES (?, ?, ?, ?)
    `).run(taskId, "BUDGET_EXCEEDED", JSON.stringify(["retry", "cancel"]), new Date().toISOString());

    db.close();
  });

  it("shows pending decisions in list", async () => {
    const code = await runDecideCommand(makeOpts());
    expect(code).toBe(0);
    expect(stdout).toContain("PENDING");
  });

  it("--json includes pending decision", async () => {
    await runDecideCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].task_id).toBe(taskId);
  });
});
