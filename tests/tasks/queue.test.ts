/**
 * Tests for src/tasks/queue.ts
 *
 * Covers:
 * - Enqueue sets status to PENDING
 * - Dequeue returns highest priority task
 * - Dequeue within same priority returns FIFO
 * - Dequeue transitions task to ASSIGNED
 * - Dequeue returns null when queue empty
 * - Peek doesn't change state
 * - Requeue resets status to PENDING
 * - getTodoList categorizes correctly (active/waiting/queued)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskQueue } from "../../src/tasks/queue.js";
import type { Database } from "../../src/utils/db.js";
import type { Task } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(store: TaskStore, overrides: Partial<Task & { priority: number }> = {}): Task {
  return store.create({
    title: "Task",
    description: "Desc",
    division: "engineering",
    type: "root",
    tier: 1,
    token_budget: 5000,
    cost_budget: 0.5,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let queue: TaskQueue;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-queue-test-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store  = new TaskStore(db);
  store.initialize();
  queue  = new TaskQueue(store);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe("TaskQueue.enqueue", () => {
  it("sets task status to PENDING", () => {
    const task = makeTask(store);
    expect(task.status).toBe("CREATED");
    queue.enqueue(task);
    expect(store.get(task.id)?.status).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// dequeue
// ---------------------------------------------------------------------------

describe("TaskQueue.dequeue", () => {
  it("returns null when queue is empty", () => {
    expect(queue.dequeue("agent-1")).toBeNull();
  });

  it("returns the PENDING task assigned to the agent", () => {
    const task = makeTask(store, { assigned_agent: "agent-1" });
    queue.enqueue(task);

    const dequeued = queue.dequeue("agent-1");
    expect(dequeued).not.toBeNull();
    expect(dequeued?.id).toBe(task.id);
    expect(dequeued?.status).toBe("ASSIGNED");
  });

  it("transitions task to ASSIGNED status", () => {
    const task = makeTask(store, { assigned_agent: "agent-1" });
    queue.enqueue(task);
    queue.dequeue("agent-1");

    expect(store.get(task.id)?.status).toBe("ASSIGNED");
  });

  it("returns highest priority task first (priority 1 > priority 5)", () => {
    const low  = makeTask(store, { assigned_agent: "agent-1", priority: 5 });
    const high = makeTask(store, { assigned_agent: "agent-1", priority: 1 });
    queue.enqueue(low);
    queue.enqueue(high);

    const first = queue.dequeue("agent-1");
    expect(first?.id).toBe(high.id);
  });

  it("within same priority, returns FIFO (created_at ascending)", async () => {
    const t1 = makeTask(store, { assigned_agent: "agent-1", priority: 3 });
    await new Promise((r) => setTimeout(r, 5));
    const t2 = makeTask(store, { assigned_agent: "agent-1", priority: 3 });
    queue.enqueue(t1);
    queue.enqueue(t2);

    const first = queue.dequeue("agent-1");
    expect(first?.id).toBe(t1.id); // t1 was created first
  });

  it("does not return tasks for a different agent", () => {
    const task = makeTask(store, { assigned_agent: "agent-A" });
    queue.enqueue(task);

    expect(queue.dequeue("agent-B")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// peek
// ---------------------------------------------------------------------------

describe("TaskQueue.peek", () => {
  it("returns the next task without changing status", () => {
    const task = makeTask(store, { assigned_agent: "agent-1" });
    queue.enqueue(task);

    const peeked = queue.peek("agent-1");
    expect(peeked?.id).toBe(task.id);
    expect(store.get(task.id)?.status).toBe("PENDING"); // still PENDING
  });

  it("returns null when queue is empty", () => {
    expect(queue.peek("agent-1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requeue
// ---------------------------------------------------------------------------

describe("TaskQueue.requeue", () => {
  it("resets status to PENDING", () => {
    const task = makeTask(store, { assigned_agent: "agent-1" });
    store.update(task.id, { status: "FAILED" });
    queue.requeue(task.id);
    expect(store.get(task.id)?.status).toBe("PENDING");
  });

  it("can change priority when requeuing", () => {
    const task = makeTask(store, { assigned_agent: "agent-1" });
    store.update(task.id, { status: "FAILED" });
    queue.requeue(task.id, 1); // escalate priority
    const updated = store.get(task.id);
    expect(updated?.status).toBe("PENDING");
    expect(updated?.priority).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getTodoList
// ---------------------------------------------------------------------------

describe("TaskQueue.getTodoList", () => {
  it("categorizes tasks into active/waiting/queued", () => {
    const running = makeTask(store, { assigned_agent: "agent-1" });
    const waiting = makeTask(store, { assigned_agent: "agent-1" });
    const pending = makeTask(store, { assigned_agent: "agent-1" });
    const done    = makeTask(store, { assigned_agent: "agent-1" });

    store.update(running.id, { status: "RUNNING" });
    store.update(waiting.id, { status: "WAITING" });
    store.update(pending.id, { status: "PENDING" });
    store.update(done.id,    { status: "DONE" });

    const todo = queue.getTodoList("agent-1");
    expect(todo.agent_id).toBe("agent-1");
    expect(todo.active.map((t) => t.id)).toContain(running.id);
    expect(todo.waiting.map((t) => t.id)).toContain(waiting.id);
    expect(todo.queued.map((t) => t.id)).toContain(pending.id);
    // DONE not in any list
    const allIds = [
      ...todo.active.map((t) => t.id),
      ...todo.waiting.map((t) => t.id),
      ...todo.queued.map((t) => t.id),
    ];
    expect(allIds).not.toContain(done.id);
  });

  it("sums token and cost budgets across active + queued tasks", () => {
    const t1 = makeTask(store, { assigned_agent: "agent-1", token_budget: 1000, cost_budget: 0.1 });
    const t2 = makeTask(store, { assigned_agent: "agent-1", token_budget: 2000, cost_budget: 0.2 });
    store.update(t1.id, { status: "RUNNING" });
    store.update(t2.id, { status: "PENDING" });

    const todo = queue.getTodoList("agent-1");
    expect(todo.total_token_budget).toBe(3000);
    expect(todo.total_cost_budget).toBeCloseTo(0.3);
  });

  it("returns empty lists for agent with no tasks", () => {
    const todo = queue.getTodoList("ghost-agent");
    expect(todo.active).toHaveLength(0);
    expect(todo.waiting).toHaveLength(0);
    expect(todo.queued).toHaveLength(0);
    expect(todo.total_token_budget).toBe(0);
    expect(todo.total_cost_budget).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getQueueDepth
// ---------------------------------------------------------------------------

describe("TaskQueue.getQueueDepth", () => {
  it("returns 0 when no tasks queued", () => {
    expect(queue.getQueueDepth("agent-1")).toBe(0);
  });

  it("counts PENDING tasks for agent", () => {
    const t1 = makeTask(store, { assigned_agent: "agent-1" });
    const t2 = makeTask(store, { assigned_agent: "agent-1" });
    store.update(t1.id, { status: "PENDING" });
    store.update(t2.id, { status: "RUNNING" }); // not counted

    expect(queue.getQueueDepth("agent-1")).toBe(1);
  });

  it("getQueueDepthByDivision counts across all agents in division", () => {
    const t1 = makeTask(store, { assigned_agent: "agent-1", division: "engineering" });
    const t2 = makeTask(store, { assigned_agent: "agent-2", division: "engineering" });
    store.update(t1.id, { status: "PENDING" });
    store.update(t2.id, { status: "PENDING" });

    expect(queue.getQueueDepthByDivision("engineering")).toBe(2);
  });
});
