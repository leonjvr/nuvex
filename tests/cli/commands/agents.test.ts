/**
 * Tests for src/cli/commands/agents.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { runAgentsCommand } from "../../../src/cli/commands/agents.js";
import { setGlobalLevel, resetLogger } from "../../../src/core/logger.js";

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
  setGlobalLevel("error"); // suppress debug/info logs so stdout stays clean for JSON parse
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-agents-test-"));
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
  resetLogger();
});

const BASE_OPTS = {
  workDir:  "",
  agentId:  undefined as string | undefined,
  tier:     undefined as number | undefined,  // kept for interface compat
  status:   undefined as string | undefined,
  json:     false,
};

function makeOpts(o: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...o };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentsCommand — no database", () => {
  it("returns 1 when DB not found", () => {
    const code = runAgentsCommand(makeOpts({ workDir: "/nonexistent" }));
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("runAgentsCommand — no agents", () => {
  it("returns 0 with empty agent message", () => {
    const code = runAgentsCommand(makeOpts());
    expect(code).toBe(0);
    expect(stdout).toContain("No agents found");
  });

  it("--json returns empty array", () => {
    runAgentsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});

describe("runAgentsCommand — with agents", () => {
  beforeEach(() => {
    const db = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");

    // Insert a mock agent_instance row
    db.prepare<unknown[], void>(`
      INSERT INTO agent_instances
        (agent_id, definition_id, status, active_task_count,
         total_tasks_completed, total_tokens_used, total_cost_millicents,
         started_at, updated_at, last_heartbeat)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "test-agent", "test-agent-def", "idle", 0,
      10, 5000, 7000,
      "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z", "2026-01-01T01:00:00Z",
    );

    db.close();
  });

  it("lists agents with idle status", () => {
    runAgentsCommand(makeOpts());
    expect(stdout).toContain("test-agent");
    expect(stdout).toContain("idle");
  });

  it("--json includes agent data", () => {
    runAgentsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].agent_id).toBe("test-agent");
  });

  it("--status filter works", () => {
    runAgentsCommand(makeOpts({ status: "idle" }));
    expect(stdout).toContain("test-agent");
  });

  it("--status filter excludes wrong status", () => {
    runAgentsCommand(makeOpts({ status: "busy" }));
    expect(stdout).not.toContain("test-agent");
    expect(stdout).toContain("No agents found");
  });

  it("detail view shows agent info", () => {
    const code = runAgentsCommand(makeOpts({ agentId: "test-agent" }));
    expect(code).toBe(0);
    expect(stdout).toContain("Agent: test-agent");
    expect(stdout).toContain("idle");
  });

  it("detail view returns 1 for unknown agent", () => {
    const code = runAgentsCommand(makeOpts({ agentId: "no-such-agent" }));
    expect(code).toBe(1);
    expect(stderr).toContain("Agent not found");
  });
});
