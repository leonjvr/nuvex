/**
 * Integration test: Multi-Producer
 *
 * Verifies that multiple producers can submit tasks concurrently and:
 * - Each producer's tasks are tracked independently
 * - PIPELINE_ACK_UPDATE notifications are routed to the correct producer
 * - getProducerPending() returns only the producer's own tasks
 * - Producers do not interfere with each other's state transitions
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { PriorityQueue } from "../../../src/pipeline/priority-queue.js";
import { AckTracker } from "../../../src/pipeline/ack-tracker.js";
import { AckState, TaskPriority } from "../../../src/pipeline/types.js";
import type { QueueEntry } from "../../../src/pipeline/types.js";
import type { Database } from "../../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir:   string;
let db:       Database;
let store:    TaskStore;
let eventBus: TaskEventBus;
let queue:    PriorityQueue;
let tracker:  AckTracker;

beforeEach(() => {
  tmpDir   = mkdtempSync(join(tmpdir(), "sidjua-mp-test-"));
  db       = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store    = new TaskStore(db);
  store.initialize();
  eventBus = new TaskEventBus(db);
  queue    = new PriorityQueue(db);
  tracker  = new AckTracker(db, eventBus);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  taskId:    string,
  producer:  string,
  consumer:  string,
  priority:  TaskPriority = TaskPriority.REGULAR,
): QueueEntry {
  const now = new Date().toISOString();
  return {
    task_id:           taskId,
    producer_agent_id: producer,
    consumer_agent_id: consumer,
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

function createTask(title = "T") {
  return store.create({
    title,
    description:  "test",
    division:     "engineering",
    type:         "root",
    tier:         2,
    token_budget: 10_000,
    cost_budget:  1.0,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Multi-producer: task isolation", () => {
  it("getProducerPending returns only tasks for the specified producer", () => {
    const tA1 = createTask("A1");
    const tA2 = createTask("A2");
    const tB1 = createTask("B1");

    queue.enqueue(makeEntry(tA1.id, "producer-A", "consumer-1"));
    queue.enqueue(makeEntry(tA2.id, "producer-A", "consumer-1"));
    queue.enqueue(makeEntry(tB1.id, "producer-B", "consumer-1"));

    const pendingA = tracker.getProducerPending("producer-A");
    const pendingB = tracker.getProducerPending("producer-B");

    expect(pendingA).toHaveLength(2);
    expect(pendingB).toHaveLength(1);

    const aIds = pendingA.map((e) => e.task_id);
    expect(aIds).toContain(tA1.id);
    expect(aIds).toContain(tA2.id);

    expect(pendingB[0]!.task_id).toBe(tB1.id);
  });

  it("transition on one producer's task does not affect other producer's tasks", () => {
    const tA = createTask("A");
    const tB = createTask("B");

    queue.enqueue(makeEntry(tA.id, "producer-A", "consumer-1"));
    queue.enqueue(makeEntry(tB.id, "producer-B", "consumer-1"));

    // Transition only producer-A's task
    tracker.transition(tA.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");

    expect(queue.getEntry(tA.id)!.ack_state).toBe(AckState.ACCEPTED);
    expect(queue.getEntry(tB.id)!.ack_state).toBe(AckState.QUEUED); // unaffected
  });

  it("completing producer-A task does not affect producer-B pending count", () => {
    const tA = createTask("A");
    const tB = createTask("B");

    queue.enqueue(makeEntry(tA.id, "producer-A", "consumer-1"));
    queue.enqueue(makeEntry(tB.id, "producer-B", "consumer-1"));

    // Complete producer-A's task
    tracker.transition(tA.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");
    tracker.transition(tA.id, AckState.ACCEPTED, AckState.RUNNING, "consumer-1");
    tracker.transition(tA.id, AckState.RUNNING, AckState.COMPLETED, "consumer-1");

    // Producer-B still has pending tasks
    const pendingB = tracker.getProducerPending("producer-B");
    expect(pendingB).toHaveLength(1);
    expect(pendingB[0]!.task_id).toBe(tB.id);
  });
});

describe("Multi-producer: PIPELINE_ACK_UPDATE routing", () => {
  it("notification is routed to the correct producer (agent_to = producer_agent_id)", () => {
    const tA = createTask("A");
    const tB = createTask("B");

    queue.enqueue(makeEntry(tA.id, "producer-A", "consumer-1"));
    queue.enqueue(makeEntry(tB.id, "producer-B", "consumer-1"));

    tracker.transition(tA.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");
    tracker.transition(tB.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");

    const events = db.prepare<[], { task_id: string; agent_to: string }>(
      "SELECT task_id, agent_to FROM task_events WHERE event_type = 'PIPELINE_ACK_UPDATE'",
    ).all();

    const eventForA = events.find((e) => e.task_id === tA.id);
    const eventForB = events.find((e) => e.task_id === tB.id);

    expect(eventForA?.agent_to).toBe("producer-A");
    expect(eventForB?.agent_to).toBe("producer-B");
  });

  it("each transition creates exactly one notification event", () => {
    const task = createTask();
    queue.enqueue(makeEntry(task.id, "producer-1", "consumer-1"));

    tracker.transition(task.id, AckState.QUEUED,   AckState.ACCEPTED, "consumer-1");
    tracker.transition(task.id, AckState.ACCEPTED, AckState.RUNNING,  "consumer-1");
    tracker.transition(task.id, AckState.RUNNING,  AckState.COMPLETED, "consumer-1");

    const events = db.prepare<[string], { id: string }>(
      "SELECT id FROM task_events WHERE task_id = ? AND event_type = 'PIPELINE_ACK_UPDATE'",
    ).all(task.id);

    expect(events).toHaveLength(3); // one per transition
  });

  it("failed transitions do not emit notifications", () => {
    const task = createTask();
    queue.enqueue(makeEntry(task.id, "producer-1", "consumer-1")); // state = QUEUED

    // Invalid transition: QUEUED → RUNNING (not allowed)
    const result = tracker.transition(task.id, AckState.QUEUED, AckState.RUNNING, "consumer-1");
    expect(result.valid).toBe(false);

    const events = db.prepare<[string], { id: string }>(
      "SELECT id FROM task_events WHERE task_id = ? AND event_type = 'PIPELINE_ACK_UPDATE'",
    ).all(task.id);

    expect(events).toHaveLength(0); // no event emitted for invalid transition
  });
});

describe("Multi-producer: concurrent submissions", () => {
  it("handles tasks from many producers without state corruption", () => {
    const PRODUCERS = 5;
    const TASKS_PER_PRODUCER = 4;

    const allTasks: Array<{ taskId: string; producer: string }> = [];

    for (let p = 0; p < PRODUCERS; p++) {
      const producer = `producer-${p}`;
      for (let t = 0; t < TASKS_PER_PRODUCER; t++) {
        const task = createTask(`P${p}-T${t}`);
        queue.enqueue(makeEntry(task.id, producer, "consumer-1"));
        allTasks.push({ taskId: task.id, producer });
      }
    }

    // Verify each producer has exactly TASKS_PER_PRODUCER pending
    for (let p = 0; p < PRODUCERS; p++) {
      const pending = tracker.getProducerPending(`producer-${p}`);
      expect(pending).toHaveLength(TASKS_PER_PRODUCER);
    }

    // Transition all tasks through ACCEPTED — state should be correct per task
    for (const { taskId } of allTasks) {
      const result = tracker.transition(taskId, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");
      expect(result.valid).toBe(true);
    }

    // All tasks should now be ACCEPTED
    for (const { taskId } of allTasks) {
      expect(queue.getEntry(taskId)!.ack_state).toBe(AckState.ACCEPTED);
    }

    // Each producer: all tasks still pending (ACCEPTED is not terminal)
    for (let p = 0; p < PRODUCERS; p++) {
      const pending = tracker.getProducerPending(`producer-${p}`);
      expect(pending).toHaveLength(TASKS_PER_PRODUCER);
    }
  });

  it("priority sorting works correctly across producers", () => {
    const pA = createTask("pA");
    const pB = createTask("pB");
    const pC = createTask("pC");

    queue.enqueue(makeEntry(pA.id, "prod-A", null as unknown as string, TaskPriority.BACKGROUND));
    queue.enqueue(makeEntry(pB.id, "prod-B", null as unknown as string, TaskPriority.CRITICAL));
    queue.enqueue(makeEntry(pC.id, "prod-C", null as unknown as string, TaskPriority.REGULAR));

    // All unassigned — any worker can pick them up in priority order
    const first  = queue.dequeueNext("worker-1")!;
    const second = queue.dequeueNext("worker-1")!;
    const third  = queue.dequeueNext("worker-1")!;

    expect(first.task_id).toBe(pB.id);   // CRITICAL
    expect(second.task_id).toBe(pC.id);  // REGULAR
    expect(third.task_id).toBe(pA.id);   // BACKGROUND
  });
});
