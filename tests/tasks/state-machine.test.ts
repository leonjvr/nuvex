/**
 * Tests for src/tasks/state-machine.ts
 *
 * Covers:
 * - Every valid transition succeeds
 * - Every invalid transition throws
 * - Side effects on transition (timestamps, counters, field changes)
 * - Cancellation cascade to children
 * - FAILED → PENDING increments retry_count
 * - ESCALATED clears assigned_agent
 * - Every transition emits correct TaskEvent
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskStateMachine } from "../../src/tasks/state-machine.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import type { Database } from "../../src/utils/db.js";
import type { Task } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(store: TaskStore, overrides: Partial<Task> = {}): Task {
  const task = store.create({
    title: "Test",
    description: "Desc",
    division: "engineering",
    type: "root",
    tier: 1,
    token_budget: 5000,
    cost_budget: 0.5,
    assigned_agent: "agent-1",
    ...overrides,
  });
  // Apply any status override
  if (overrides.status !== undefined && overrides.status !== "CREATED") {
    return store.update(task.id, { status: overrides.status });
  }
  return task;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let eventBus: TaskEventBus;
let sm: TaskStateMachine;

beforeEach(() => {
  tmpDir   = mkdtempSync(join(tmpdir(), "sidjua-sm-test-"));
  db       = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store    = new TaskStore(db);
  store.initialize();
  eventBus = new TaskEventBus(db);
  sm       = new TaskStateMachine(store, eventBus);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isValidTransition / validTransitions
// ---------------------------------------------------------------------------

describe("TaskStateMachine.isValidTransition", () => {
  it("allows all valid transitions", () => {
    const valid: Array<[string, string]> = [
      ["CREATED",   "PENDING"],
      ["CREATED",   "CANCELLED"],
      ["PENDING",   "ASSIGNED"],
      ["PENDING",   "CANCELLED"],
      ["ASSIGNED",  "RUNNING"],
      ["ASSIGNED",  "CANCELLED"],
      ["RUNNING",   "WAITING"],
      ["RUNNING",   "REVIEW"],
      ["RUNNING",   "DONE"],
      ["RUNNING",   "FAILED"],
      ["RUNNING",   "CANCELLED"],
      ["WAITING",   "RUNNING"],
      ["WAITING",   "FAILED"],
      ["WAITING",   "CANCELLED"],
      ["REVIEW",    "DONE"],
      ["REVIEW",    "FAILED"],
      ["REVIEW",    "ESCALATED"],
      ["FAILED",    "PENDING"],
      ["FAILED",    "ESCALATED"],
      ["FAILED",    "CANCELLED"],
      ["ESCALATED", "ASSIGNED"],
    ];
    for (const [from, to] of valid) {
      expect(
        sm.isValidTransition(from as never, to as never),
        `${from} → ${to} should be valid`,
      ).toBe(true);
    }
  });

  it("rejects invalid transitions", () => {
    const invalid: Array<[string, string]> = [
      ["DONE",      "RUNNING"],
      ["DONE",      "FAILED"],
      ["CANCELLED", "PENDING"],
      ["CANCELLED", "RUNNING"],
      ["CREATED",   "RUNNING"],
      ["PENDING",   "RUNNING"],
      ["ASSIGNED",  "WAITING"],
    ];
    for (const [from, to] of invalid) {
      expect(
        sm.isValidTransition(from as never, to as never),
        `${from} → ${to} should be invalid`,
      ).toBe(false);
    }
  });

  it("DONE and CANCELLED are terminal (no valid transitions)", () => {
    expect(sm.validTransitions("DONE")).toHaveLength(0);
    expect(sm.validTransitions("CANCELLED")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// transition() — success paths
// ---------------------------------------------------------------------------

describe("TaskStateMachine.transition — success", () => {
  it("CREATED → PENDING succeeds", async () => {
    const task = makeTask(store);
    const updated = await sm.transition(task, "PENDING");
    expect(updated.status).toBe("PENDING");
  });

  it("PENDING → ASSIGNED sets assigned_agent from context", async () => {
    const task = makeTask(store, { status: "PENDING" });
    const updated = await sm.transition(task, "ASSIGNED", { agent_id: "agent-42" });
    expect(updated.status).toBe("ASSIGNED");
    expect(updated.assigned_agent).toBe("agent-42");
  });

  it("ASSIGNED → RUNNING sets started_at", async () => {
    const task = makeTask(store, { status: "ASSIGNED" });
    expect(task.started_at).toBeNull();
    const updated = await sm.transition(task, "RUNNING");
    expect(updated.started_at).not.toBeNull();
  });

  it("RUNNING → DONE sets completed_at, result_summary, confidence", async () => {
    const task = makeTask(store, { status: "RUNNING" });
    const updated = await sm.transition(task, "DONE", {
      result_summary: "Work is done",
      confidence: 0.95,
    });
    expect(updated.status).toBe("DONE");
    expect(updated.completed_at).not.toBeNull();
    expect(updated.result_summary).toBe("Work is done");
    expect(updated.confidence).toBe(0.95);
  });

  it("RUNNING → FAILED increments retry_count and records error", async () => {
    const task = makeTask(store, { status: "RUNNING" });
    expect(task.retry_count).toBe(0);
    const updated = await sm.transition(task, "FAILED", {
      error_message: "Network timeout",
    });
    expect(updated.retry_count).toBe(1);
    expect(updated.metadata["last_error"]).toBe("Network timeout");
  });

  it("FAILED → PENDING: second failure gives retry_count = 2", async () => {
    let task = makeTask(store, { status: "RUNNING" });
    task = await sm.transition(task, "FAILED");   // retry_count → 1
    task = await sm.transition(task, "PENDING");  // back to queue
    task = store.update(task.id, { status: "RUNNING" });
    task = await sm.transition(task, "FAILED");   // retry_count → 2
    expect(task.retry_count).toBe(2);
  });

  it("ESCALATED → clears assigned_agent", async () => {
    const task = makeTask(store, { status: "REVIEW", assigned_agent: "agent-1" });
    const updated = await sm.transition(task, "ESCALATED");
    expect(updated.assigned_agent).toBeNull();
  });

  it("RUNNING → CANCELLED sets completed_at", async () => {
    const task = makeTask(store, { status: "RUNNING" });
    const updated = await sm.transition(task, "CANCELLED");
    expect(updated.status).toBe("CANCELLED");
    expect(updated.completed_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transition() — invalid transitions throw
// ---------------------------------------------------------------------------

describe("TaskStateMachine.transition — invalid throws", () => {
  it("throws on DONE → RUNNING", async () => {
    const task = makeTask(store, { status: "DONE" });
    await expect(sm.transition(task, "RUNNING")).rejects.toThrow("Invalid transition");
  });

  it("throws on CANCELLED → PENDING", async () => {
    const task = makeTask(store, { status: "CANCELLED" });
    await expect(sm.transition(task, "PENDING")).rejects.toThrow("Invalid transition");
  });

  it("throws on CREATED → RUNNING (skipping states)", async () => {
    const task = makeTask(store);
    await expect(sm.transition(task, "RUNNING")).rejects.toThrow("Invalid transition");
  });
});

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

describe("TaskStateMachine — event emission", () => {
  it("CREATED → PENDING emits TASK_CREATED event", async () => {
    const task = makeTask(store);
    await sm.transition(task, "PENDING");

    const events = await eventBus.consume("*");
    // Check any event with the task_id was emitted
    const allEvents = db
      .prepare<[], { event_type: string; task_id: string }>(
        "SELECT event_type, task_id FROM task_events ORDER BY created_at DESC",
      )
      .all();
    expect(allEvents[0]?.event_type).toBe("TASK_CREATED");
    expect(allEvents[0]?.task_id).toBe(task.id);
    void events;
  });

  it("RUNNING → FAILED emits TASK_FAILED event", async () => {
    const task = makeTask(store, { status: "RUNNING" });
    await sm.transition(task, "FAILED");

    const allEvents = db
      .prepare<[], { event_type: string }>(
        "SELECT event_type FROM task_events ORDER BY created_at DESC LIMIT 1",
      )
      .all();
    expect(allEvents[0]?.event_type).toBe("TASK_FAILED");
  });

  it("RUNNING → CANCELLED emits TASK_CANCELLED event", async () => {
    const task = makeTask(store, { status: "RUNNING" });
    await sm.transition(task, "CANCELLED");

    const allEvents = db
      .prepare<[], { event_type: string }>(
        "SELECT event_type FROM task_events WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .all(task.id);
    expect(allEvents[0]?.event_type).toBe("TASK_CANCELLED");
  });

  it("REVIEW → ESCALATED emits TASK_ESCALATED event", async () => {
    const task = makeTask(store, { status: "REVIEW" });
    await sm.transition(task, "ESCALATED");

    const allEvents = db
      .prepare<[], { event_type: string }>(
        "SELECT event_type FROM task_events ORDER BY created_at DESC LIMIT 1",
      )
      .all();
    expect(allEvents[0]?.event_type).toBe("TASK_ESCALATED");
  });
});

// ---------------------------------------------------------------------------
// Cancellation cascade
// ---------------------------------------------------------------------------

describe("TaskStateMachine — cancellation cascade", () => {
  it("cancels all direct children when parent is cancelled", async () => {
    const parent = makeTask(store, { status: "RUNNING" });
    const child1 = store.create({
      title: "Child 1", description: "d", division: "engineering",
      type: "delegation", tier: 2, parent_id: parent.id, root_id: parent.id,
      token_budget: 1000, cost_budget: 0.1,
    });
    store.update(child1.id, { status: "RUNNING" });
    const child2 = store.create({
      title: "Child 2", description: "d", division: "engineering",
      type: "delegation", tier: 2, parent_id: parent.id, root_id: parent.id,
      token_budget: 1000, cost_budget: 0.1,
    });
    store.update(child2.id, { status: "PENDING" });

    await sm.transition(parent, "CANCELLED");

    expect(store.get(child1.id)?.status).toBe("CANCELLED");
    expect(store.get(child2.id)?.status).toBe("CANCELLED");
  });

  it("cascades recursively to grandchildren", async () => {
    const root = makeTask(store, { status: "RUNNING" });
    const child = store.create({
      title: "Child", description: "d", division: "engineering",
      type: "delegation", tier: 2, parent_id: root.id, root_id: root.id,
      token_budget: 1000, cost_budget: 0.1,
    });
    store.update(child.id, { status: "RUNNING" });
    const grandchild = store.create({
      title: "Grandchild", description: "d", division: "engineering",
      type: "delegation", tier: 3, parent_id: child.id, root_id: root.id,
      token_budget: 500, cost_budget: 0.05,
    });
    store.update(grandchild.id, { status: "RUNNING" });

    await sm.transition(root, "CANCELLED");

    expect(store.get(child.id)?.status).toBe("CANCELLED");
    expect(store.get(grandchild.id)?.status).toBe("CANCELLED");
  });

  it("does not cancel already-DONE children", async () => {
    const parent = makeTask(store, { status: "RUNNING" });
    const done = store.create({
      title: "Done", description: "d", division: "engineering",
      type: "delegation", tier: 2, parent_id: parent.id, root_id: parent.id,
      token_budget: 1000, cost_budget: 0.1,
    });
    store.update(done.id, { status: "DONE" });

    await sm.transition(parent, "CANCELLED");

    // DONE child stays DONE
    expect(store.get(done.id)?.status).toBe("DONE");
  });
});
