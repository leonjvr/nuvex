/**
 * Tests for src/pipeline/priority-queue.ts
 *
 * Covers:
 * - enqueue() persists to DB
 * - dequeueNext() returns highest priority first
 * - dequeueNext() FIFO within same priority
 * - dequeueNext() skips expired tasks
 * - dequeueNext() atomically updates state (no double delivery)
 * - dequeueNext() respects consumer_agent_id assignment
 * - dequeueNext() also picks unassigned tasks (consumer_agent_id IS NULL)
 * - requeue() puts task back with optional priority change
 * - requeue() respects excluded_agents
 * - boostStarved() promotes REGULAR→URGENT after threshold
 * - boostStarved() promotes LOW→REGULAR
 * - boostStarved() does not boost CRITICAL
 * - boostStarved() preserves original_priority
 * - expireStale() marks expired tasks
 * - expireStale() only affects QUEUED state
 * - size() correct counts with filters
 * - purgeCompleted() removes old terminal entries
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { PriorityQueue } from "../../src/pipeline/priority-queue.js";
import { AckState, TaskPriority } from "../../src/pipeline/types.js";
import type { QueueEntry } from "../../src/pipeline/types.js";
import type { Database } from "../../src/utils/db.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let queue: PriorityQueue;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-pq-test-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store  = new TaskStore(db);
  store.initialize();
  queue  = new PriorityQueue(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<CreateTaskInput> = {}) {
  return store.create({
    title:        "Task",
    description:  "Test",
    division:     "engineering",
    type:         "root",
    tier:         2,
    token_budget: 10_000,
    cost_budget:  1.0,
    ...overrides,
  });
}

function makeEntry(
  taskId:    string,
  priority:  TaskPriority    = TaskPriority.REGULAR,
  consumer:  string | null   = "agent-1",
  overrides: Partial<QueueEntry> = {},
): QueueEntry {
  const now       = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  return {
    task_id:           taskId,
    producer_agent_id: "producer-1",
    consumer_agent_id: consumer,
    priority,
    original_priority: priority,
    ack_state:         AckState.QUEUED,
    queued_at:         now,
    accepted_at:       null,
    started_at:        null,
    completed_at:      null,
    ttl_expires_at:    expiresAt,
    delivery_attempts: 0,
    last_delivery_at:  null,
    excluded_agents:   [],
    metadata:          {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe("PriorityQueue.enqueue", () => {
  it("persists entry to DB", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR));

    const found = queue.getEntry(task.id);
    expect(found).not.toBeNull();
    expect(found!.task_id).toBe(task.id);
    expect(found!.priority).toBe(TaskPriority.REGULAR);
    expect(found!.ack_state).toBe(AckState.QUEUED);
  });

  it("persists excluded_agents as JSON", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1", {
      excluded_agents: ["agent-2", "agent-3"],
    }));

    const found = queue.getEntry(task.id);
    expect(found!.excluded_agents).toEqual(["agent-2", "agent-3"]);
  });

  it("persists metadata as JSON", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1", {
      metadata: { hint: "use-gpu" },
    }));

    const found = queue.getEntry(task.id);
    expect(found!.metadata).toEqual({ hint: "use-gpu" });
  });
});

// ---------------------------------------------------------------------------
// dequeueNext
// ---------------------------------------------------------------------------

describe("PriorityQueue.dequeueNext", () => {
  it("returns highest priority task first (CRITICAL before REGULAR)", () => {
    const regular  = makeTask();
    const critical = makeTask();
    queue.enqueue(makeEntry(regular.id,  TaskPriority.REGULAR,  "agent-1"));
    queue.enqueue(makeEntry(critical.id, TaskPriority.CRITICAL, "agent-1"));

    const first = queue.dequeueNext("agent-1");
    expect(first!.task_id).toBe(critical.id);
    expect(first!.priority).toBe(TaskPriority.CRITICAL);
  });

  it("FIFO within same priority (oldest first)", () => {
    const t1 = makeTask();
    const t2 = makeTask();
    const now = Date.now();

    queue.enqueue(makeEntry(t1.id, TaskPriority.REGULAR, "agent-1", {
      queued_at: new Date(now - 2000).toISOString(), // older
    }));
    queue.enqueue(makeEntry(t2.id, TaskPriority.REGULAR, "agent-1", {
      queued_at: new Date(now - 1000).toISOString(), // newer
    }));

    const first = queue.dequeueNext("agent-1");
    expect(first!.task_id).toBe(t1.id); // t1 came first
  });

  it("skips expired tasks", () => {
    const expired = makeTask();
    const valid   = makeTask();

    queue.enqueue(makeEntry(expired.id, TaskPriority.REGULAR, "agent-1", {
      ttl_expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
    }));
    queue.enqueue(makeEntry(valid.id, TaskPriority.REGULAR, "agent-1"));

    const result = queue.dequeueNext("agent-1");
    expect(result!.task_id).toBe(valid.id);
  });

  it("atomically updates state to ACCEPTED (no double delivery)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    const first  = queue.dequeueNext("agent-1");
    const second = queue.dequeueNext("agent-1"); // should find nothing

    expect(first).not.toBeNull();
    expect(first!.ack_state).toBe(AckState.ACCEPTED);
    expect(second).toBeNull(); // already claimed
  });

  it("respects consumer_agent_id assignment (agent-2 cannot dequeue agent-1's task)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1")); // assigned to agent-1

    const result = queue.dequeueNext("agent-2");
    expect(result).toBeNull();
  });

  it("picks unassigned tasks (consumer_agent_id IS NULL)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, null)); // unassigned

    const result = queue.dequeueNext("agent-1"); // any agent can claim
    expect(result).not.toBeNull();
    expect(result!.task_id).toBe(task.id);
  });

  it("skips tasks where agent is in excluded_agents", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, null, {
      excluded_agents: ["agent-1"],
    }));

    const result = queue.dequeueNext("agent-1");
    expect(result).toBeNull(); // agent-1 is excluded
  });

  it("returns null when queue is empty", () => {
    const result = queue.dequeueNext("agent-1");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// peek
// ---------------------------------------------------------------------------

describe("PriorityQueue.peek", () => {
  it("returns top N tasks without modifying state", () => {
    const t1 = makeTask();
    const t2 = makeTask();
    queue.enqueue(makeEntry(t1.id, TaskPriority.REGULAR, "agent-1"));
    queue.enqueue(makeEntry(t2.id, TaskPriority.URGENT,  "agent-1"));

    const results = queue.peek("agent-1", 5);
    expect(results).toHaveLength(2);
    expect(results[0]!.priority).toBe(TaskPriority.URGENT); // highest first

    // Still QUEUED (not ACCEPTED)
    expect(queue.getEntry(t1.id)!.ack_state).toBe(AckState.QUEUED);
    expect(queue.getEntry(t2.id)!.ack_state).toBe(AckState.QUEUED);
  });
});

// ---------------------------------------------------------------------------
// requeue
// ---------------------------------------------------------------------------

describe("PriorityQueue.requeue", () => {
  it("resets task to QUEUED state", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    // Simulate acceptance
    queue.updateState(task.id, AckState.ACCEPTED, { accepted_at: new Date().toISOString() });
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.ACCEPTED);

    queue.requeue(task.id);
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.QUEUED);
  });

  it("optionally changes priority", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.LOW));

    queue.requeue(task.id, TaskPriority.URGENT);
    expect(queue.getEntry(task.id)!.priority).toBe(TaskPriority.URGENT);
  });

  it("adds excluded agent to excluded_agents list", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1"));

    queue.requeue(task.id, undefined, "agent-1");

    const entry = queue.getEntry(task.id)!;
    expect(entry.excluded_agents).toContain("agent-1");
    expect(entry.consumer_agent_id).toBeNull(); // cleared
  });

  it("accumulates excluded agents across multiple requeues", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    queue.requeue(task.id, undefined, "agent-1");
    queue.requeue(task.id, undefined, "agent-2");

    const entry = queue.getEntry(task.id)!;
    expect(entry.excluded_agents).toContain("agent-1");
    expect(entry.excluded_agents).toContain("agent-2");
  });

  it("no-op for unknown task", () => {
    // Should not throw
    expect(() => queue.requeue("nonexistent-task")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// boostStarved
// ---------------------------------------------------------------------------

describe("PriorityQueue.boostStarved", () => {
  it("promotes REGULAR→URGENT after threshold", () => {
    const task = makeTask();
    const old  = new Date(Date.now() - 400_000).toISOString(); // 400s ago (> 5min)

    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1", { queued_at: old }));

    const count = queue.boostStarved(300_000); // 5min threshold
    expect(count).toBe(1);
    expect(queue.getEntry(task.id)!.priority).toBe(TaskPriority.URGENT);
  });

  it("promotes LOW→REGULAR after threshold", () => {
    const task = makeTask();
    const old  = new Date(Date.now() - 400_000).toISOString();

    queue.enqueue(makeEntry(task.id, TaskPriority.LOW, "agent-1", { queued_at: old }));

    queue.boostStarved(300_000);
    expect(queue.getEntry(task.id)!.priority).toBe(TaskPriority.REGULAR);
  });

  it("does NOT boost CRITICAL (already highest)", () => {
    const task = makeTask();
    const old  = new Date(Date.now() - 400_000).toISOString();

    queue.enqueue(makeEntry(task.id, TaskPriority.CRITICAL, "agent-1", { queued_at: old }));

    const count = queue.boostStarved(300_000);
    expect(count).toBe(0); // CRITICAL cannot be boosted further
    expect(queue.getEntry(task.id)!.priority).toBe(TaskPriority.CRITICAL);
  });

  it("preserves original_priority after boost", () => {
    const task = makeTask();
    const old  = new Date(Date.now() - 400_000).toISOString();

    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1", {
      queued_at:         old,
      original_priority: TaskPriority.REGULAR,
    }));

    queue.boostStarved(300_000);

    const entry = queue.getEntry(task.id)!;
    expect(entry.priority).toBe(TaskPriority.URGENT);       // boosted
    expect(entry.original_priority).toBe(TaskPriority.REGULAR); // preserved
  });

  it("does NOT boost tasks that haven't waited long enough", () => {
    const task = makeTask(); // queued_at = now
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR));

    const count = queue.boostStarved(300_000);
    expect(count).toBe(0);
    expect(queue.getEntry(task.id)!.priority).toBe(TaskPriority.REGULAR);
  });
});

// ---------------------------------------------------------------------------
// expireStale
// ---------------------------------------------------------------------------

describe("PriorityQueue.expireStale", () => {
  it("marks QUEUED tasks past TTL as EXPIRED", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1", {
      ttl_expires_at: new Date(Date.now() - 1000).toISOString(), // already expired
    }));

    const expired = queue.expireStale();
    expect(expired).toHaveLength(1);
    expect(expired[0]!.task_id).toBe(task.id);
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.EXPIRED);
  });

  it("does not expire tasks with future TTL", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    const expired = queue.expireStale();
    expect(expired).toHaveLength(0);
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.QUEUED);
  });

  it("only affects QUEUED tasks (not ACCEPTED/RUNNING)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1", {
      ttl_expires_at: new Date(Date.now() - 1000).toISOString(),
    }));
    // Advance to ACCEPTED
    queue.updateState(task.id, AckState.ACCEPTED, { accepted_at: new Date().toISOString() });

    const expired = queue.expireStale();
    expect(expired).toHaveLength(0); // ACCEPTED tasks not expired
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.ACCEPTED);
  });
});

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

describe("PriorityQueue.size", () => {
  it("returns total QUEUED count", () => {
    const t1 = makeTask();
    const t2 = makeTask();
    queue.enqueue(makeEntry(t1.id, TaskPriority.REGULAR));
    queue.enqueue(makeEntry(t2.id, TaskPriority.URGENT));

    expect(queue.size()).toBe(2);
  });

  it("filters by agent_id", () => {
    const t1 = makeTask();
    const t2 = makeTask();
    queue.enqueue(makeEntry(t1.id, TaskPriority.REGULAR, "agent-1"));
    queue.enqueue(makeEntry(t2.id, TaskPriority.REGULAR, "agent-2"));

    expect(queue.size("agent-1")).toBe(1);
    expect(queue.size("agent-2")).toBe(1);
  });

  it("filters by priority", () => {
    const t1 = makeTask();
    const t2 = makeTask();
    queue.enqueue(makeEntry(t1.id, TaskPriority.CRITICAL, "agent-1"));
    queue.enqueue(makeEntry(t2.id, TaskPriority.REGULAR,  "agent-1"));

    expect(queue.size(undefined, TaskPriority.CRITICAL)).toBe(1);
    expect(queue.size(undefined, TaskPriority.REGULAR)).toBe(1);
  });

  it("excludes non-QUEUED tasks from count", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.ACCEPTED, { accepted_at: new Date().toISOString() });

    expect(queue.size()).toBe(0); // not QUEUED
  });
});

// ---------------------------------------------------------------------------
// purgeCompleted
// ---------------------------------------------------------------------------

describe("PriorityQueue.purgeCompleted", () => {
  it("removes old terminal entries", () => {
    const task = makeTask();
    const old  = new Date(Date.now() - 100_000).toISOString();

    queue.enqueue(makeEntry(task.id, TaskPriority.REGULAR, "agent-1", { queued_at: old }));
    queue.updateState(task.id, AckState.COMPLETED, { completed_at: new Date().toISOString() });

    const removed = queue.purgeCompleted(50_000); // 50s threshold — entry is 100s old
    expect(removed).toBe(1);
    expect(queue.getEntry(task.id)).toBeNull();
  });

  it("preserves recent terminal entries", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.COMPLETED, { completed_at: new Date().toISOString() });

    const removed = queue.purgeCompleted(600_000); // 10min threshold — entry is fresh
    expect(removed).toBe(0);
  });
});
