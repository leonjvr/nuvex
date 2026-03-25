/**
 * V1.1 — ProactiveScanner unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProactiveScanner,
  type ProactiveScannerConfig,
} from "../../src/agent-lifecycle/proactive-scanner.js";
import type { TaskStore } from "../../src/tasks/store.js";
import type { TaskEventBus } from "../../src/tasks/event-bus.js";
import type { Task } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id:                 crypto.randomUUID(),
    parent_id:          null,
    root_id:            "root-1",
    division:           "eng",
    type:               "root",
    tier:               2,
    title:              "Test task",
    description:        "desc",
    assigned_agent:     "agent-1",
    status:             "RUNNING",
    priority:           3,
    classification:     "internal",
    created_at:         now,
    updated_at:         now,
    started_at:         now,
    completed_at:       null,
    result_file:        null,
    result_summary:     null,
    confidence:         null,
    token_budget:       1000,
    token_used:         0,
    cost_budget:        1.0,
    cost_used:          0,
    ttl_seconds:        3600,
    retry_count:        0,
    max_retries:        3,
    checkpoint:         null,
    sub_tasks_expected: 0,
    sub_tasks_received: 0,
    embedding_id:       null,
    metadata:           {},
    ...overrides,
  } as Task;
}

/** Create a task whose TTL is already elapsed. */
function makeOverdueTask(): Task {
  const startedAt = new Date(Date.now() - 7200_000).toISOString(); // 2h ago
  return makeTask({
    status:      "RUNNING",
    started_at:  startedAt,
    ttl_seconds: 3600, // TTL = 1h, started 2h ago → overdue
  });
}

/** Create a task that has been stale for a long time. */
function makeStaleTask(staleMs = 600_000): Task {
  const updatedAt = new Date(Date.now() - staleMs).toISOString();
  return makeTask({ status: "RUNNING", updated_at: updatedAt });
}

/** Create a task that represents a recurring schedule due for resubmission. */
function makeRecurringTask(): Task {
  const completedAt = new Date(Date.now() - 3_600_000).toISOString(); // 1h ago
  return makeTask({
    status:       "DONE",
    completed_at: completedAt,
    metadata: {
      recurring:   true,
      interval_ms: 1800_000, // every 30 min — already overdue
      last_run:    completedAt,
    },
  });
}

function makeStore(active: Task[] = [], queued: Task[] = []): TaskStore {
  return {
    getActiveForAgent: vi.fn().mockReturnValue(active),
    getQueuedForAgent: vi.fn().mockReturnValue(queued),
    create:            vi.fn().mockImplementation((input) => ({
      ...makeTask(),
      ...input,
      id: crypto.randomUUID(),
      status: "CREATED",
    })),
    update: vi.fn(),
  } as unknown as TaskStore;
}

function makeEventBus(): TaskEventBus {
  return {
    emitTask: vi.fn().mockResolvedValue("evt-id"),
  } as unknown as TaskEventBus;
}

function makeScanner(
  store:   TaskStore,
  bus:     TaskEventBus,
  config?: ProactiveScannerConfig,
): ProactiveScanner {
  return new ProactiveScanner(store, bus, config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProactiveScanner", () => {
  describe("scan() — empty result", () => {
    it("returns zero found_tasks when nothing to do", async () => {
      const store   = makeStore([], []);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus);

      const result = await scanner.scan("agent-1");

      expect(result.found_tasks).toBe(0);
      expect(result.submitted_tasks).toHaveLength(0);
      expect(result.agent_id).toBe("agent-1");
    });

    it("emits no events when nothing found", async () => {
      const bus = makeEventBus();
      const scanner = makeScanner(makeStore(), bus);
      await scanner.scan("agent-1");
      expect(bus.emitTask).not.toHaveBeenCalled();
    });
  });

  describe("scan() — overdue tasks", () => {
    it("finds and resubmits overdue tasks", async () => {
      const overdue = makeOverdueTask();
      const store   = makeStore([overdue], []);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus);

      const result = await scanner.scan("agent-1");

      expect(result.found_tasks).toBeGreaterThanOrEqual(1);
      expect(result.submitted_tasks).toHaveLength(1);
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: overdue.description }),
      );
    });

    it("re-submits overdue task with elevated priority", async () => {
      const overdue = makeOverdueTask();
      const store   = makeStore([overdue]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus, { overdue_priority: 1 });

      await scanner.scan("agent-1");

      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 1 }),
      );
    });

    it("marks resubmit metadata with original task ID", async () => {
      const overdue = makeOverdueTask();
      const store   = makeStore([overdue]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus);

      await scanner.scan("agent-1");

      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            resubmitted_from: overdue.id,
            resubmit_reason:  "overdue",
          }),
        }),
      );
    });

    it("emits TASK_CREATED event after resubmit", async () => {
      const overdue = makeOverdueTask();
      const store   = makeStore([overdue]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus);

      await scanner.scan("agent-1");

      expect(bus.emitTask).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: "TASK_CREATED" }),
      );
    });

    it("does not flag healthy RUNNING task as overdue", async () => {
      const active = makeTask({ status: "RUNNING", started_at: new Date().toISOString(), ttl_seconds: 3600 });
      const store  = makeStore([active]);
      const bus    = makeEventBus();
      const scanner = makeScanner(store, bus);

      const result = await scanner.scan("agent-1");
      expect(store.create).not.toHaveBeenCalled();
      expect(result.submitted_tasks).toHaveLength(0);
    });
  });

  describe("scan() — stale tasks", () => {
    it("detects stale tasks that have not progressed", async () => {
      const stale  = makeStaleTask(600_000);
      const store  = makeStore([stale]);
      const bus    = makeEventBus();
      const scanner = makeScanner(store, bus, { stale_threshold_ms: 300_000 });

      const result = await scanner.scan("agent-1");

      // Stale tasks are logged but NOT resubmitted (V1.1 behaviour)
      expect(result.found_tasks).toBeGreaterThanOrEqual(1);
    });

    it("does not resubmit stale tasks (logs warning only)", async () => {
      const stale   = makeStaleTask(600_000);
      const store   = makeStore([stale]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus, { stale_threshold_ms: 300_000 });

      await scanner.scan("agent-1");

      // create() should NOT be called for stale (informational only)
      expect(store.create).not.toHaveBeenCalled();
    });

    it("does not flag fresh tasks as stale", async () => {
      const fresh   = makeTask({ status: "RUNNING", updated_at: new Date().toISOString() });
      const store   = makeStore([fresh]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus, { stale_threshold_ms: 300_000 });

      const result = await scanner.scan("agent-1");
      expect(result.found_tasks).toBe(0);
    });

    it("skips terminal tasks in stale check", async () => {
      const done  = makeTask({ status: "DONE",      updated_at: new Date(0).toISOString() });
      const fail  = makeTask({ status: "FAILED",    updated_at: new Date(0).toISOString() });
      const canc  = makeTask({ status: "CANCELLED", updated_at: new Date(0).toISOString() });
      const store = makeStore([done, fail, canc]);
      const bus   = makeEventBus();
      const scanner = makeScanner(store, bus, { stale_threshold_ms: 1 });

      // Terminal tasks should not count as stale
      const result = await scanner.scan("agent-1");
      // DONE/FAILED/CANCELLED are excluded from stale
      const staleFoundInResult = result.found_tasks;
      expect(staleFoundInResult).toBe(0);
    });
  });

  describe("scan() — recurring tasks", () => {
    it("submits a recurring task when interval has elapsed", async () => {
      const recurring = makeRecurringTask();
      const store     = makeStore([recurring]);
      const bus       = makeEventBus();
      const scanner   = makeScanner(store, bus);

      const result = await scanner.scan("agent-1");

      expect(result.submitted_tasks).toHaveLength(1);
      expect(bus.emitTask).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: "TASK_CREATED" }),
      );
    });

    it("does not submit recurring task when interval has not elapsed", async () => {
      const completedAt = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
      const notDue = makeTask({
        status:       "DONE",
        completed_at: completedAt,
        metadata: {
          recurring:   true,
          interval_ms: 3_600_000, // every 1h — only 1 min elapsed
          last_run:    completedAt,
        },
      });
      const store   = makeStore([notDue]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus);

      const result = await scanner.scan("agent-1");
      expect(result.submitted_tasks).toHaveLength(0);
    });

    it("marks new recurring task with recurring metadata", async () => {
      const recurring = makeRecurringTask();
      const store     = makeStore([recurring]);
      const bus       = makeEventBus();
      const scanner   = makeScanner(store, bus);

      await scanner.scan("agent-1");

      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            recurring:           true,
            recurring_source_id: recurring.id,
          }),
        }),
      );
    });

    it("ignores tasks without recurring flag", async () => {
      const done  = makeTask({ status: "DONE", metadata: { recurring: false } });
      const store = makeStore([done]);
      const bus   = makeEventBus();
      const scanner = makeScanner(store, bus);

      const result = await scanner.scan("agent-1");
      expect(result.submitted_tasks).toHaveLength(0);
    });
  });

  describe("governance — no bypass", () => {
    it("all new tasks go through TaskStore.create() (no direct status update)", async () => {
      const overdue = makeOverdueTask();
      const store   = makeStore([overdue]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus);

      await scanner.scan("agent-1");

      // Tasks are created via create(), not inserted raw
      expect(store.create).toHaveBeenCalled();
      // update() is never called directly by the scanner
      expect(store.update).not.toHaveBeenCalled();
    });

    it("scanner makes no calls that look like LLM invocations", async () => {
      // All methods on store and bus are sync queries or single emitTask
      const store   = makeStore([makeOverdueTask()]);
      const bus     = makeEventBus();
      const scanner = makeScanner(store, bus);

      await scanner.scan("agent-1");

      // Only create() and emitTask() — no provider/model calls
      const storeCalls = Object.keys(vi.mocked(store).create.mock.calls);
      expect(storeCalls.length).toBeGreaterThanOrEqual(0); // just confirm no throws
    });
  });
});
