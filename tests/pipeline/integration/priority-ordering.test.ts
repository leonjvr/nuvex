/**
 * Integration test: Priority Ordering
 *
 * Verifies that tasks are dispatched in priority order (CRITICAL first,
 * then URGENT, REGULAR, LOW, BACKGROUND) and FIFO within the same lane.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { PriorityQueue } from "../../../src/pipeline/priority-queue.js";
import { AckState, TaskPriority } from "../../../src/pipeline/types.js";
import type { QueueEntry } from "../../../src/pipeline/types.js";
import type { Database } from "../../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db:     Database;
let store:  TaskStore;
let queue:  PriorityQueue;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-priority-test-"));
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

function makeEntry(taskId: string, priority: TaskPriority, offsetMs = 0): QueueEntry {
  const t = new Date(Date.now() + offsetMs).toISOString();
  return {
    task_id:           taskId,
    producer_agent_id: "producer-1",
    consumer_agent_id: null, // unassigned → any agent can claim
    priority,
    original_priority: priority,
    ack_state:         AckState.QUEUED,
    queued_at:         t,
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

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe("Priority ordering — CRITICAL before REGULAR before BACKGROUND", () => {
  it("dequeues tasks in priority order regardless of insertion order", () => {
    const background = store.create({ title: "bg",   description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const regular    = store.create({ title: "reg",  description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const critical   = store.create({ title: "crit", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const urgent     = store.create({ title: "urg",  description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const low        = store.create({ title: "low",  description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });

    // Insert in "worst" order (background first, critical last)
    queue.enqueue(makeEntry(background.id, TaskPriority.BACKGROUND, 0));
    queue.enqueue(makeEntry(regular.id,    TaskPriority.REGULAR,    1));
    queue.enqueue(makeEntry(low.id,        TaskPriority.LOW,        2));
    queue.enqueue(makeEntry(urgent.id,     TaskPriority.URGENT,     3));
    queue.enqueue(makeEntry(critical.id,   TaskPriority.CRITICAL,   4));

    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      const entry = queue.dequeueNext("worker-1");
      if (entry !== null) order.push(entry.task_id);
    }

    expect(order).toHaveLength(5);
    expect(order[0]).toBe(critical.id);    // CRITICAL = 0
    expect(order[1]).toBe(urgent.id);      // URGENT = 1
    expect(order[2]).toBe(regular.id);     // REGULAR = 2
    expect(order[3]).toBe(low.id);         // LOW = 3
    expect(order[4]).toBe(background.id);  // BACKGROUND = 4
  });
});

describe("FIFO ordering within same priority lane", () => {
  it("dequeues older tasks first when priority is equal", () => {
    const now = Date.now();
    const t1  = store.create({ title: "t1", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const t2  = store.create({ title: "t2", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const t3  = store.create({ title: "t3", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });

    queue.enqueue(makeEntry(t2.id, TaskPriority.REGULAR, 100));  // newer
    queue.enqueue(makeEntry(t1.id, TaskPriority.REGULAR, -200)); // oldest
    queue.enqueue(makeEntry(t3.id, TaskPriority.REGULAR, 0));    // middle

    const first  = queue.dequeueNext("worker-1")!;
    const second = queue.dequeueNext("worker-1")!;
    const third  = queue.dequeueNext("worker-1")!;

    // t1 queued 200ms before now (oldest), t3 queued at now, t2 queued 100ms after now
    expect(first.task_id).toBe(t1.id);
    expect(second.task_id).toBe(t3.id);
    expect(third.task_id).toBe(t2.id);
  });
});

describe("Priority with starvation boost", () => {
  it("LOW task promoted to REGULAR after starvation boost", () => {
    const critical = store.create({ title: "c", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const low      = store.create({ title: "l", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });

    const longAgo = new Date(Date.now() - 400_000).toISOString();

    queue.enqueue(makeEntry(critical.id, TaskPriority.CRITICAL));
    queue.enqueue({
      ...makeEntry(low.id, TaskPriority.LOW),
      queued_at: longAgo, // 400s ago
    });

    // Boost tasks older than 300s
    const boosted = queue.boostStarved(300_000);
    expect(boosted).toBe(1); // only LOW can be boosted (CRITICAL is at 0)

    const entry = queue.getEntry(low.id)!;
    expect(entry.priority).toBe(TaskPriority.REGULAR); // LOW(3) → REGULAR(2) wait no: LOW→? Let me think
    // Actually LOW=3, boost by -1 → 2 = REGULAR. Yes.
    expect(entry.original_priority).toBe(TaskPriority.LOW); // preserved
  });
});

describe("Multi-priority queue with expiry", () => {
  it("expired tasks are skipped during dequeue", () => {
    const alive   = store.create({ title: "alive",   description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const expired = store.create({ title: "expired", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });

    // Critical but expired
    queue.enqueue({
      ...makeEntry(expired.id, TaskPriority.CRITICAL),
      ttl_expires_at: new Date(Date.now() - 1_000).toISOString(), // already expired
    });
    // Regular and alive
    queue.enqueue(makeEntry(alive.id, TaskPriority.REGULAR));

    const result = queue.dequeueNext("worker-1");
    // Should skip expired CRITICAL and return REGULAR alive task
    expect(result!.task_id).toBe(alive.id);
    expect(result!.priority).toBe(TaskPriority.REGULAR);
  });

  it("expireStale marks all overdue QUEUED tasks and returns their IDs", () => {
    const t1 = store.create({ title: "t1", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const t2 = store.create({ title: "t2", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const t3 = store.create({ title: "t3", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });

    queue.enqueue({ ...makeEntry(t1.id, TaskPriority.CRITICAL), ttl_expires_at: new Date(Date.now() - 5_000).toISOString() });
    queue.enqueue({ ...makeEntry(t2.id, TaskPriority.REGULAR),  ttl_expires_at: new Date(Date.now() - 1_000).toISOString() });
    queue.enqueue(makeEntry(t3.id, TaskPriority.BACKGROUND)); // not expired

    const expired = queue.expireStale();
    expect(expired).toHaveLength(2);
    const ids = expired.map((e) => e.task_id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
    expect(ids).not.toContain(t3.id);

    // t3 is still QUEUED
    expect(queue.getEntry(t3.id)!.ack_state).toBe(AckState.QUEUED);
    // t1 and t2 are EXPIRED
    expect(queue.getEntry(t1.id)!.ack_state).toBe(AckState.EXPIRED);
    expect(queue.getEntry(t2.id)!.ack_state).toBe(AckState.EXPIRED);
  });
});
