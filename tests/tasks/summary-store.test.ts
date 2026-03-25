/**
 * Tests for src/tasks/summary-store.ts — Phase 14
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { TaskSummaryStore }   from "../../src/tasks/summary-store.js";
import type { CreateSummaryInput } from "../../src/tasks/summary-store.js";
import { isSidjuaError }      from "../../src/core/error-codes.js";

type Db = InstanceType<typeof BetterSqlite3>;

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function validInput(overrides: Partial<CreateSummaryInput> = {}): CreateSummaryInput {
  return {
    task_id:      "task-001",
    agent_id:     "agent-001",
    summary_text: "Task completed successfully.",
    key_facts:    ["Processed 100 records", "No errors"],
    status:       "completed",
    ...overrides,
  };
}

let db: Db;
let store: TaskSummaryStore;

beforeEach(() => {
  db    = makeDb();
  store = new TaskSummaryStore(db);
  store.initialize();
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// create valid summary
// ---------------------------------------------------------------------------

describe("create() with valid input", () => {
  it("stores summary and returns TaskSummary", () => {
    const s = store.create(validInput());

    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.task_id).toBe("task-001");
    expect(s.status).toBe("completed");
    expect(s.key_facts).toEqual(["Processed 100 records", "No errors"]);
    expect(s.escalation_needed).toBe(false);
    expect(s.decisions).toEqual([]);
    expect(s.metrics).toEqual({});
    expect(s.output_refs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// governance validation
// ---------------------------------------------------------------------------

describe("create() governance validation", () => {
  it("throws SUMMARY-001 when key_facts is empty", () => {
    expect(() => store.create(validInput({ key_facts: [] }))).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && err.code === "SUMMARY-001"; }
      },
    );
  });

  it("throws SUMMARY-002 for invalid status", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.create(validInput({ status: "invalid" as any })),
    ).toSatisfy((fn: () => void) => {
      try { fn(); return false; }
      catch (err) { return isSidjuaError(err) && err.code === "SUMMARY-002"; }
    });
  });

  it("throws SUMMARY-003 when summary_text exceeds 8000 chars", () => {
    expect(() =>
      store.create(validInput({ summary_text: "x".repeat(8001) })),
    ).toSatisfy((fn: () => void) => {
      try { fn(); return false; }
      catch (err) { return isSidjuaError(err) && err.code === "SUMMARY-003"; }
    });
  });
});

// ---------------------------------------------------------------------------
// getLatestByTaskId
// ---------------------------------------------------------------------------

describe("getLatestByTaskId()", () => {
  it("returns the most recent summary for a task", () => {
    store.create(validInput({ key_facts: ["first"] }));
    store.create(validInput({ key_facts: ["second"] }));

    const latest = store.getLatestByTaskId("task-001");
    expect(latest).not.toBeNull();
    expect(latest!.key_facts).toEqual(["second"]);
  });

  it("returns null when no summary exists", () => {
    expect(store.getLatestByTaskId("nonexistent")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// query with status filter
// ---------------------------------------------------------------------------

describe("query() with filters", () => {
  beforeEach(() => {
    store.create(validInput({ task_id: "t1", status: "completed" }));
    store.create(validInput({ task_id: "t2", status: "failed",    key_facts: ["f"] }));
    store.create(validInput({ task_id: "t3", status: "escalated", key_facts: ["e"] }));
  });

  it("filters by status", () => {
    const results = store.query({ status: "failed" });
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("failed");
  });

  it("count() reflects filters", () => {
    expect(store.count()).toBe(3);
    expect(store.count({ status: "escalated" })).toBe(1);
  });
});
