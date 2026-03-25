/**
 * Tests for src/cli/commands/queue.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { PriorityQueue } from "../../../src/pipeline/priority-queue.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { AckState, TaskPriority } from "../../../src/pipeline/types.js";
import type { QueueEntry } from "../../../src/pipeline/types.js";
import { runQueueCommand } from "../../../src/cli/commands/queue.js";
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
  tmpDir  = mkdtempSync(join(tmpdir(), "sidjua-queue-test-"));
  dbFile  = join(tmpDir, ".system", "sidjua.db");
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runQueueCommand — no database", () => {
  it("returns 1 when no DB", () => {
    const code = runQueueCommand({ workDir: "/nonexistent", agent: undefined, json: false });
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("runQueueCommand — empty queue", () => {
  it("returns 0 with empty queue", () => {
    const code = runQueueCommand({ workDir: tmpDir, agent: undefined, json: false });
    expect(code).toBe(0);
    expect(stdout).toContain("PIPELINE STATUS");
    expect(stdout).toContain("Total queued: 0");
  });

  it("--json returns valid JSON with empty data", () => {
    runQueueCommand({ workDir: tmpDir, agent: undefined, json: true });
    const data = JSON.parse(stdout);
    expect(data.total_queued).toBe(0);
    expect(Array.isArray(data.by_priority)).toBe(true);
  });
});

describe("runQueueCommand — with queued tasks", () => {
  function makeEntry(taskId: string, agentId: string | null, priority: TaskPriority): QueueEntry {
    const now = new Date().toISOString();
    return {
      task_id:           taskId,
      producer_agent_id: "producer-1",
      consumer_agent_id: agentId as string,
      priority,
      original_priority: priority,
      ack_state:         AckState.QUEUED,
      queued_at:         now,
      accepted_at:       null,
      started_at:        null,
      completed_at:      null,
      ttl_expires_at:    new Date(Date.now() + 600_000).toISOString(),
      delivery_attempts: 0,
      last_delivery_at:  null,
      excluded_agents:   [],
      metadata:          {},
    };
  }

  it("shows non-zero queued count", () => {
    const db    = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    const store = new TaskStore(db);
    const pq    = new PriorityQueue(db);

    const task = store.create({
      title: "T1", description: "", division: "eng", type: "root", tier: 2,
      token_budget: 1000, cost_budget: 0.1,
    });

    pq.enqueue(makeEntry(task.id, "agent-1", TaskPriority.REGULAR));
    db.close();

    stdout = "";
    runQueueCommand({ workDir: tmpDir, agent: undefined, json: false });
    expect(stdout).toContain("Total queued: 1");
  });

  it("--json priority breakdown", () => {
    const db    = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    const store = new TaskStore(db);
    const pq    = new PriorityQueue(db);

    const t1 = store.create({ title: "A", description: "", division: "eng", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const t2 = store.create({ title: "B", description: "", division: "eng", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });

    pq.enqueue(makeEntry(t1.id, "agent-1", TaskPriority.URGENT));
    pq.enqueue(makeEntry(t2.id, "agent-1", TaskPriority.URGENT));
    db.close();

    // Reset stdout after data setup (PriorityQueue.enqueue logs to stdout)
    stdout = "";
    runQueueCommand({ workDir: tmpDir, agent: undefined, json: true });
    const data = JSON.parse(stdout);
    expect(data.total_queued).toBe(2);
    const urgentEntry = data.by_priority.find((r: { priority: number }) => r.priority === TaskPriority.URGENT);
    expect(urgentEntry?.count).toBe(2);
  });
});
