/**
 * Tests for src/cli/commands/run.ts
 *
 * Note: runRunCommand requires a running orchestrator (PID file check).
 * Tests use the current process PID as a fake "running" orchestrator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { runRunCommand } from "../../../src/cli/commands/run.js";

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
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-run-test-"));
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
  workDir:     "",
  description: undefined as string | undefined,
  file:        undefined as string | undefined,
  priority:    "regular",
  division:    undefined as string | undefined,
  budget:      undefined as number | undefined,
  costLimit:   undefined as number | undefined,
  tier:        2,
  wait:        false,
  timeout:     30,
  json:        false,
};

function makeOpts(o: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...o };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runRunCommand — no orchestrator running", () => {
  it("returns 1 when no PID file", async () => {
    const code = await runRunCommand(makeOpts({ description: "test task" }));
    expect(code).toBe(1);
    expect(stderr).toContain("Orchestrator not running");
  });
});

describe("runRunCommand — with fake orchestrator PID", () => {
  beforeEach(() => {
    // Write current process PID so the command thinks orchestrator is running
    const pidFile = join(tmpDir, ".system", "orchestrator.pid");
    writeFileSync(pidFile, String(process.pid), "utf8");
  });

  it("returns 1 when no description and no file", async () => {
    const code = await runRunCommand(makeOpts());
    expect(code).toBe(1);
    expect(stderr).toContain("Provide a description");
  });

  it("creates task from inline description", async () => {
    const code = await runRunCommand(makeOpts({ description: "Analyze Q4 results" }));
    expect(code).toBe(0);
    expect(stdout).toContain("Task submitted");
  });

  it("--json returns task id", async () => {
    stdout = "";
    await runRunCommand(makeOpts({ description: "JSON task", json: true }));
    const data = JSON.parse(stdout);
    expect(typeof data.task_id).toBe("string");
  });
});

describe("runRunCommand — file size limits", () => {
  beforeEach(() => {
    const pidFile = join(tmpDir, ".system", "orchestrator.pid");
    writeFileSync(pidFile, String(process.pid), "utf8");
  });

  it("returns 1 when task file exceeds 1 MB limit", async () => {
    const bigFile = join(tmpDir, "big-task.yaml");
    // Write 1 MB + 1 byte
    writeFileSync(bigFile, "x".repeat(1 * 1024 * 1024 + 1), "utf8");
    const code = await runRunCommand(makeOpts({ file: bigFile }));
    expect(code).toBe(1);
    expect(stderr).toContain("too large");
  });

  it("accepts task file within 1 MB limit", async () => {
    const smallFile = join(tmpDir, "small-task.yaml");
    writeFileSync(smallFile, "title: test task\ndescription: small\n", "utf8");
    const code = await runRunCommand(makeOpts({ file: smallFile }));
    // May fail for other reasons (YAML structure), but NOT for size
    expect(stderr).not.toContain("too large");
  });
});
