/**
 * Tests for src/cli/commands/health.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { runHealthCommand } from "../../../src/cli/commands/health.js";

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

let stdout = "";
let stderr = "";

function captureOutput(): void {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-health-test-"));
  captureOutput();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runHealthCommand — no orchestrator running", () => {
  it("returns exit code 1 when no PID file", () => {
    const code = runHealthCommand({ workDir: tmpDir, json: false });
    expect(code).toBe(1);
  });

  it("prints NOT RUNNING message", () => {
    runHealthCommand({ workDir: tmpDir, json: false });
    expect(stdout).toContain("NOT RUNNING");
    expect(stdout).toContain("sidjua start");
  });

  it("--json returns success=false for orchestrator in JSON", () => {
    runHealthCommand({ workDir: tmpDir, json: true });
    const data = JSON.parse(stdout);
    expect(data.orchestrator.running).toBe(false);
  });

  it("reports database not found when no DB", () => {
    runHealthCommand({ workDir: tmpDir, json: false });
    expect(stdout).toContain("NOT FOUND");
  });
});

describe("runHealthCommand — with database", () => {
  let dbFile: string;

  beforeEach(() => {
    const systemDir = join(tmpDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    dbFile = join(systemDir, "sidjua.db");

    const db = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    db.exec(PHASE9_SCHEMA_SQL);
    const store = new TaskStore(db);
    store.initialize();
    db.close();
  });

  it("reports database OK when DB exists", () => {
    runHealthCommand({ workDir: tmpDir, json: false });
    expect(stdout).toContain("OK");
    expect(stdout).toContain("sidjua.db");
  });

  it("--json includes database.ok = true", () => {
    runHealthCommand({ workDir: tmpDir, json: true });
    const data = JSON.parse(stdout);
    expect(data.database.ok).toBe(true);
    expect(data.database.exists).toBe(true);
  });

  it("--json task counts are present", () => {
    runHealthCommand({ workDir: tmpDir, json: true });
    const data = JSON.parse(stdout);
    expect(data.tasks).toBeDefined();
  });
});

describe("runHealthCommand — stale PID file", () => {
  it("handles process not found gracefully (stale PID)", () => {
    const systemDir = join(tmpDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    writeFileSync(join(systemDir, "orchestrator.pid"), "999999999", "utf8");

    const code = runHealthCommand({ workDir: tmpDir, json: false });
    // PID doesn't exist → stale → not running
    expect(code).toBe(1);
    expect(stdout).toContain("NOT RUNNING");
  });
});
