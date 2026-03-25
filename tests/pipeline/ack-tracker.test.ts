/**
 * Tests for src/pipeline/ack-tracker.ts
 *
 * Covers:
 * - transition() QUEUED→ACCEPTED valid
 * - transition() ACCEPTED→RUNNING valid
 * - transition() RUNNING→COMPLETED valid
 * - transition() RUNNING→FAILED valid
 * - transition() QUEUED→RUNNING invalid (must ACCEPT first)
 * - transition() COMPLETED→RUNNING invalid (terminal state)
 * - transition() task not found returns invalid
 * - transition() state mismatch (wrong `from`) returns invalid
 * - transition() persists to history table
 * - notifyProducer() emits PIPELINE_ACK_UPDATE event to SQLite
 * - notifyProducer() includes correct producer_agent_id in agent_to
 * - checkAckTimeouts() finds ACCEPTED tasks past ack_timeout_ms
 * - checkRunningTimeouts() finds stuck ACCEPTED tasks (accepted but not running)
 * - getHistory() returns full transition chain in order
 * - getProducerPending() returns non-terminal tasks for producer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import { PriorityQueue } from "../../src/pipeline/priority-queue.js";
import { AckTracker } from "../../src/pipeline/ack-tracker.js";
import { AckState, TaskPriority } from "../../src/pipeline/types.js";
import type { QueueEntry } from "../../src/pipeline/types.js";
import type { Database } from "../../src/utils/db.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";

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
  tmpDir   = mkdtempSync(join(tmpdir(), "sidjua-ack-test-"));
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

function makeTask(overrides: Partial<CreateTaskInput> = {}) {
  return store.create({
    title:        "Test Task",
    description:  "Unit test",
    division:     "engineering",
    type:         "root",
    tier:         2,
    token_budget: 10_000,
    cost_budget:  1.0,
    ...overrides,
  });
}

function makeEntry(
  taskId:   string,
  consumer: string | null = "consumer-1",
  overrides: Partial<QueueEntry> = {},
): QueueEntry {
  const now       = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  return {
    task_id:           taskId,
    producer_agent_id: "producer-1",
    consumer_agent_id: consumer,
    priority:          TaskPriority.REGULAR,
    original_priority: TaskPriority.REGULAR,
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
// transition — valid paths
// ---------------------------------------------------------------------------

describe("AckTracker.transition — valid transitions", () => {
  it("QUEUED → ACCEPTED is valid and updates state", () => {
    const task  = makeTask();
    queue.enqueue(makeEntry(task.id));

    const result = tracker.transition(task.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");
    expect(result.valid).toBe(true);
    expect(result.notification).toBeDefined();
    expect(result.notification!.new_state).toBe(AckState.ACCEPTED);

    const entry = queue.getEntry(task.id)!;
    expect(entry.ack_state).toBe(AckState.ACCEPTED);
    expect(entry.accepted_at).not.toBeNull();
  });

  it("ACCEPTED → RUNNING is valid and sets started_at", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.ACCEPTED, { accepted_at: new Date().toISOString() });

    const result = tracker.transition(task.id, AckState.ACCEPTED, AckState.RUNNING, "consumer-1");
    expect(result.valid).toBe(true);

    const entry = queue.getEntry(task.id)!;
    expect(entry.ack_state).toBe(AckState.RUNNING);
    expect(entry.started_at).not.toBeNull();
  });

  it("RUNNING → COMPLETED is valid and sets completed_at", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.RUNNING, {
      accepted_at: new Date().toISOString(),
      started_at:  new Date().toISOString(),
    });

    const result = tracker.transition(task.id, AckState.RUNNING, AckState.COMPLETED, "consumer-1");
    expect(result.valid).toBe(true);

    const entry = queue.getEntry(task.id)!;
    expect(entry.ack_state).toBe(AckState.COMPLETED);
    expect(entry.completed_at).not.toBeNull();
  });

  it("RUNNING → FAILED is valid and sets completed_at", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.RUNNING, {
      accepted_at: new Date().toISOString(),
      started_at:  new Date().toISOString(),
    });

    const result = tracker.transition(task.id, AckState.RUNNING, AckState.FAILED, "consumer-1");
    expect(result.valid).toBe(true);
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.FAILED);
  });

  it("ACCEPTED → REJECTED is valid", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.ACCEPTED, { accepted_at: new Date().toISOString() });

    const result = tracker.transition(task.id, AckState.ACCEPTED, AckState.REJECTED, "consumer-1");
    expect(result.valid).toBe(true);
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.REJECTED);
  });

  it("QUEUED → CANCELLED is valid", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    const result = tracker.transition(task.id, AckState.QUEUED, AckState.CANCELLED, "producer-1");
    expect(result.valid).toBe(true);
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.CANCELLED);
  });
});

// ---------------------------------------------------------------------------
// transition — invalid paths
// ---------------------------------------------------------------------------

describe("AckTracker.transition — invalid transitions", () => {
  it("QUEUED → RUNNING is invalid (must ACCEPT first)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    const result = tracker.transition(task.id, AckState.QUEUED, AckState.RUNNING, "consumer-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not allowed");

    // State unchanged
    expect(queue.getEntry(task.id)!.ack_state).toBe(AckState.QUEUED);
  });

  it("COMPLETED → RUNNING is invalid (terminal state)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.COMPLETED, {
      accepted_at:  new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const result = tracker.transition(task.id, AckState.COMPLETED, AckState.RUNNING, "consumer-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not allowed");
  });

  it("ACCEPTED → QUEUED is invalid (no direct back-transition)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.ACCEPTED, { accepted_at: new Date().toISOString() });

    const result = tracker.transition(task.id, AckState.ACCEPTED, AckState.QUEUED, "consumer-1");
    expect(result.valid).toBe(false);
  });

  it("returns invalid when task does not exist", () => {
    const result = tracker.transition("nonexistent-task", AckState.QUEUED, AckState.ACCEPTED, "consumer-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("returns invalid when actual state does not match expected `from`", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id)); // state is QUEUED

    // Caller thinks it's ACCEPTED, but it's QUEUED → state mismatch
    const result = tracker.transition(task.id, AckState.ACCEPTED, AckState.RUNNING, "consumer-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Expected state");
  });
});

// ---------------------------------------------------------------------------
// History persistence
// ---------------------------------------------------------------------------

describe("AckTracker.transition — history persistence", () => {
  it("persists each transition to pipeline_ack_history", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    tracker.transition(task.id, AckState.QUEUED,    AckState.ACCEPTED, "consumer-1", "agent accepted");
    tracker.transition(task.id, AckState.ACCEPTED,  AckState.RUNNING,  "consumer-1", "started work");
    tracker.transition(task.id, AckState.RUNNING,   AckState.COMPLETED, "consumer-1", "done");

    const history = tracker.getHistory(task.id);
    expect(history).toHaveLength(3);
    expect(history[0]!.from_state).toBe(AckState.QUEUED);
    expect(history[0]!.to_state).toBe(AckState.ACCEPTED);
    expect(history[1]!.from_state).toBe(AckState.ACCEPTED);
    expect(history[1]!.to_state).toBe(AckState.RUNNING);
    expect(history[2]!.from_state).toBe(AckState.RUNNING);
    expect(history[2]!.to_state).toBe(AckState.COMPLETED);
  });

  it("records details in history", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    tracker.transition(task.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1", "my details");

    const history = tracker.getHistory(task.id);
    expect(history[0]!.details).toBe("my details");
    expect(history[0]!.agent_id).toBe("consumer-1");
    expect(history[0]!.timestamp).toBeDefined();
  });

  it("getHistory returns empty array for unknown task", () => {
    const history = tracker.getHistory("ghost-task");
    expect(history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Producer notifications
// ---------------------------------------------------------------------------

describe("AckTracker.notifyProducer", () => {
  it("emits PIPELINE_ACK_UPDATE event to SQLite (verifiable from DB)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, "consumer-1", { producer_agent_id: "producer-agent" }));

    tracker.transition(task.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");

    // Event should be in the task_events table
    const events = db.prepare<[string], { event_type: string; agent_to: string }>(
      "SELECT event_type, agent_to FROM task_events WHERE task_id = ? AND event_type = 'PIPELINE_ACK_UPDATE'",
    ).all(task.id);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.event_type).toBe("PIPELINE_ACK_UPDATE");
  });

  it("sets agent_to = producer_agent_id in the emitted event", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, "consumer-1", { producer_agent_id: "the-producer" }));

    tracker.transition(task.id, AckState.QUEUED, AckState.ACCEPTED, "consumer-1");

    const event = db.prepare<[string], { agent_to: string }>(
      "SELECT agent_to FROM task_events WHERE task_id = ? AND event_type = 'PIPELINE_ACK_UPDATE' LIMIT 1",
    ).get(task.id);

    expect(event?.agent_to).toBe("the-producer");
  });

  it("notifyProducer can be called directly with a PipelineNotification", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));

    // Should not throw
    expect(() => tracker.notifyProducer({
      task_id:           task.id,
      producer_agent_id: "producer-1",
      consumer_agent_id: "consumer-1",
      previous_state:    AckState.QUEUED,
      new_state:         AckState.ACCEPTED,
      timestamp:         new Date().toISOString(),
      details:           "direct notification test",
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Timeout detection
// ---------------------------------------------------------------------------

describe("AckTracker.checkAckTimeouts", () => {
  it("finds ACCEPTED tasks where last_delivery_at is older than ack_timeout_ms", () => {
    const task     = makeTask();
    const oldDelivery = new Date(Date.now() - 20_000).toISOString(); // 20s ago

    queue.enqueue(makeEntry(task.id, "consumer-1", {
      last_delivery_at: oldDelivery,
    }));
    // Set to ACCEPTED state
    queue.updateState(task.id, AckState.ACCEPTED, {
      accepted_at:      new Date().toISOString(),
      last_delivery_at: oldDelivery,
    });

    const timedOut = tracker.checkAckTimeouts(10_000); // 10s timeout
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]!.task_id).toBe(task.id);
    expect(timedOut[0]!.ack_state).toBe(AckState.ACCEPTED);
  });

  it("does not include tasks with recent last_delivery_at", () => {
    const task     = makeTask();
    const recent   = new Date(Date.now() - 1_000).toISOString(); // 1s ago

    queue.enqueue(makeEntry(task.id, "consumer-1", {
      last_delivery_at: recent,
    }));
    queue.updateState(task.id, AckState.ACCEPTED, {
      accepted_at:      new Date().toISOString(),
      last_delivery_at: recent,
    });

    const timedOut = tracker.checkAckTimeouts(10_000); // 10s timeout
    expect(timedOut).toHaveLength(0);
  });

  it("does not include QUEUED tasks (only ACCEPTED)", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id)); // state = QUEUED

    const timedOut = tracker.checkAckTimeouts(0); // any threshold
    expect(timedOut).toHaveLength(0);
  });
});

describe("AckTracker.checkRunningTimeouts", () => {
  it("finds ACCEPTED tasks with old accepted_at and no started_at", () => {
    const task      = makeTask();
    const oldAccept = new Date(Date.now() - 30_000).toISOString(); // 30s ago

    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.ACCEPTED, {
      accepted_at:      oldAccept,
      last_delivery_at: new Date().toISOString(),
    });
    // Note: started_at remains NULL → "stuck"

    const stuck = tracker.checkRunningTimeouts(20_000); // 20s threshold
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.task_id).toBe(task.id);
  });

  it("does not flag ACCEPTED tasks with recent accepted_at", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.ACCEPTED, {
      accepted_at:      new Date().toISOString(),
      last_delivery_at: new Date().toISOString(),
    });

    const stuck = tracker.checkRunningTimeouts(20_000);
    expect(stuck).toHaveLength(0);
  });

  it("does not flag RUNNING tasks (started_at is set)", () => {
    const task = makeTask();
    const old  = new Date(Date.now() - 30_000).toISOString();

    queue.enqueue(makeEntry(task.id));
    queue.updateState(task.id, AckState.RUNNING, {
      accepted_at:  old,
      started_at:   old, // has started_at → NOT stuck
    });

    const stuck = tracker.checkRunningTimeouts(20_000);
    expect(stuck).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getProducerPending
// ---------------------------------------------------------------------------

describe("AckTracker.getProducerPending", () => {
  it("returns all non-terminal tasks for a producer", () => {
    const t1 = makeTask();
    const t2 = makeTask();
    const t3 = makeTask();

    queue.enqueue(makeEntry(t1.id, "c-1", { producer_agent_id: "producer-A" }));
    queue.enqueue(makeEntry(t2.id, "c-1", { producer_agent_id: "producer-A" }));
    queue.enqueue(makeEntry(t3.id, "c-1", { producer_agent_id: "producer-B" })); // different producer

    const pending = tracker.getProducerPending("producer-A");
    expect(pending).toHaveLength(2);
    expect(pending.map((e) => e.task_id)).toContain(t1.id);
    expect(pending.map((e) => e.task_id)).toContain(t2.id);
    expect(pending.map((e) => e.task_id)).not.toContain(t3.id);
  });

  it("does not return COMPLETED tasks for producer", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, "c-1", { producer_agent_id: "producer-A" }));
    queue.updateState(task.id, AckState.COMPLETED, {
      accepted_at:  new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    const pending = tracker.getProducerPending("producer-A");
    expect(pending).toHaveLength(0);
  });

  it("does not return CANCELLED tasks for producer", () => {
    const task = makeTask();
    queue.enqueue(makeEntry(task.id, "c-1", { producer_agent_id: "producer-A" }));
    queue.updateState(task.id, AckState.CANCELLED, { completed_at: new Date().toISOString() });

    const pending = tracker.getProducerPending("producer-A");
    expect(pending).toHaveLength(0);
  });

  it("returns empty array when producer has no pending tasks", () => {
    const pending = tracker.getProducerPending("ghost-producer");
    expect(pending).toEqual([]);
  });

  it("includes tasks in ACCEPTED and RUNNING states", () => {
    const t1 = makeTask();
    const t2 = makeTask();

    queue.enqueue(makeEntry(t1.id, "c-1", { producer_agent_id: "producer-A" }));
    queue.enqueue(makeEntry(t2.id, "c-1", { producer_agent_id: "producer-A" }));

    queue.updateState(t1.id, AckState.ACCEPTED, { accepted_at: new Date().toISOString() });
    queue.updateState(t2.id, AckState.RUNNING, {
      accepted_at: new Date().toISOString(),
      started_at:  new Date().toISOString(),
    });

    const pending = tracker.getProducerPending("producer-A");
    expect(pending).toHaveLength(2);
    const states = pending.map((e) => e.ack_state);
    expect(states).toContain(AckState.ACCEPTED);
    expect(states).toContain(AckState.RUNNING);
  });
});
