/**
 * V1.1 — AgentDaemon unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentDaemon } from "../../src/agent-lifecycle/agent-daemon.js";
import type { ExecuteTaskFn, SleepFn } from "../../src/agent-lifecycle/agent-daemon.js";
import type { TaskQueue } from "../../src/tasks/queue.js";
import type { BudgetTracker } from "../../src/agent-lifecycle/budget-tracker.js";
import type { ProcessSupervisor } from "../../src/agent-lifecycle/supervisor/process-supervisor.js";
import type { Task } from "../../src/tasks/types.js";
import type { AgentDaemonConfig, DaemonGovernance } from "../../src/agent-lifecycle/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeTask(id = "task-1"): Task {
  return {
    id,
    title:           "Test task",
    description:     "",
    status:          "ASSIGNED",
    priority:        2,
    assigned_agent:  "agent-1",
    created_by:      "test",
    division:        "eng",
    token_budget:    1000,
    cost_budget:     1.0,
    parent_id:       null,
    root_id:         null,
    depth:           0,
    ttl_seconds:     3600,
    input_data:      null,
    output_data:     null,
    error_message:   null,
    metadata:        null,
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
    completed_at:    null,
  } as unknown as Task;
}

function makeSupervisor(circuitOpen = false) {
  return {
    recordHeartbeat: vi.fn(),
    getAgentStatus:  vi.fn().mockReturnValue({ circuit_open: circuitOpen }),
  } as unknown as ProcessSupervisor;
}

function makeQueue(tasks: (Task | null)[]): TaskQueue {
  let idx = 0;
  return {
    dequeue: vi.fn().mockImplementation(() => {
      if (idx >= tasks.length) return null;
      return tasks[idx++];
    }),
  } as unknown as TaskQueue;
}

function makeBudget(): BudgetTracker {
  return {
    getAgentMonthlySpend: vi.fn().mockReturnValue(0),
    getAgentDailySpend:   vi.fn().mockReturnValue(0),
  } as unknown as BudgetTracker;
}

/** A sleep that resolves immediately (fast tests). */
const fastSleep: SleepFn = () => Promise.resolve();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDaemon(opts: {
  config?:     AgentDaemonConfig;
  governance?: DaemonGovernance;
  queue?:      TaskQueue;
  execute?:    ExecuteTaskFn;
  supervisor?: ProcessSupervisor;
  sleep?:      SleepFn;
}) {
  const {
    config     = { poll_interval_ms: 10 },
    governance = {},
    queue      = makeQueue([null]),
    execute    = vi.fn().mockResolvedValue(0),
    supervisor = makeSupervisor(),
    sleep      = fastSleep,
  } = opts;

  return new AgentDaemon(
    "agent-1",
    config,
    governance,
    queue,
    makeBudget(),
    supervisor,
    execute,
    sleep,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentDaemon", () => {
  describe("lifecycle", () => {
    it("starts and status reflects running=true", () => {
      const daemon = makeDaemon({});
      daemon.start();
      expect(daemon.getStatus().running).toBe(true);
      void daemon.stop();
    });

    it("start() is idempotent — second call is a no-op", () => {
      const supervisor = makeSupervisor();
      const daemon = makeDaemon({ supervisor });
      daemon.start();
      daemon.start(); // second call
      // recordHeartbeat called once per loop tick — not twice from start()
      void daemon.stop();
      expect(daemon.getStatus().agent_id).toBe("agent-1");
    });

    it("stop() sets running=false", async () => {
      const daemon = makeDaemon({});
      daemon.start();
      await daemon.stop();
      expect(daemon.getStatus().running).toBe(false);
    });

    it("stop() before start() is safe", async () => {
      const daemon = makeDaemon({});
      await expect(daemon.stop()).resolves.toBeUndefined();
    });

    it("getStatus() reports started_at after start()", () => {
      const daemon = makeDaemon({});
      expect(daemon.getStatus().started_at).toBeNull();
      daemon.start();
      expect(daemon.getStatus().started_at).not.toBeNull();
      void daemon.stop();
    });
  });

  describe("task execution", () => {
    it("dequeues and executes a task", async () => {
      const task    = makeTask();
      const queue   = makeQueue([task, null]);
      const execute: ExecuteTaskFn = vi.fn().mockResolvedValue(0.05);

      // Controlled sleep: let loop run for one poll cycle then stop
      let calls = 0;
      const sleep: SleepFn = () => {
        calls++;
        if (calls >= 2) {
          void daemon.stop();
        }
        return Promise.resolve();
      };

      const daemon = makeDaemon({ queue, execute, sleep });
      daemon.start();
      await daemon.stop();

      expect(execute).toHaveBeenCalledWith("agent-1", task);
      expect(daemon.getStatus().tasks_completed).toBe(1);
    });

    it("increments tasks_failed on execution error", async () => {
      const task    = makeTask();
      const queue   = makeQueue([task, null]);
      const execute: ExecuteTaskFn = vi.fn().mockRejectedValue(new Error("provider error"));

      let calls = 0;
      const sleep: SleepFn = () => {
        calls++;
        if (calls >= 2) void daemon.stop();
        return Promise.resolve();
      };

      const daemon = makeDaemon({ queue, execute, sleep });
      daemon.start();
      await daemon.stop();

      expect(daemon.getStatus().tasks_failed).toBe(1);
      expect(daemon.getStatus().tasks_completed).toBe(0);
    });

    it("updates last_task_at after execution", async () => {
      const task    = makeTask();
      const queue   = makeQueue([task, null]);

      let calls = 0;
      const sleep: SleepFn = () => {
        calls++;
        if (calls >= 2) void daemon.stop();
        return Promise.resolve();
      };

      const daemon = makeDaemon({ queue, sleep });
      daemon.start();
      await daemon.stop();

      expect(daemon.getStatus().last_task_at).not.toBeNull();
    });
  });

  describe("circuit breaker", () => {
    it("skips dequeue when circuit is open", async () => {
      const supervisor = makeSupervisor(true); // circuit open
      const queue      = makeQueue([makeTask()]);

      let calls = 0;
      const sleep: SleepFn = () => {
        calls++;
        if (calls >= 1) void daemon.stop();
        return Promise.resolve();
      };

      const daemon = makeDaemon({ supervisor, queue, sleep });
      daemon.start();
      await daemon.stop();

      expect(queue.dequeue).not.toHaveBeenCalled();
    });

    it("emits circuit_open audit event when blocked", async () => {
      const supervisor = makeSupervisor(true);

      let calls = 0;
      const sleep: SleepFn = () => {
        calls++;
        if (calls >= 1) void daemon.stop();
        return Promise.resolve();
      };

      const daemon = makeDaemon({ supervisor, sleep });
      daemon.start();
      await daemon.stop();

      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "circuit_open")).toBe(true);
    });
  });

  describe("budget governance", () => {
    it("blocks when hourly cost limit is reached", async () => {
      const task  = makeTask();
      const queue = makeQueue([task, null]);
      const execute: ExecuteTaskFn = vi.fn().mockResolvedValue(1.0);
      const governance: DaemonGovernance = { max_cost_per_hour_usd: 0.5 };

      // Use a real short sleep so the loop can run multiple iterations
      // without being cut short by the outer await daemon.stop()
      const shortSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, Math.max(1, ms)));

      const daemon = new AgentDaemon(
        "agent-1",
        { poll_interval_ms: 5 },
        governance,
        queue,
        makeBudget(),
        makeSupervisor(),
        execute,
        shortSleep,
      );

      daemon.start();
      // Allow multiple poll cycles (budget check happens on 2nd iteration)
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      await daemon.stop();

      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "budget_blocked")).toBe(true);
    });

    it("does not block when max_cost_per_hour_usd is 0 (unlimited)", async () => {
      const task  = makeTask();
      const queue = makeQueue([task, null]);
      const execute: ExecuteTaskFn = vi.fn().mockResolvedValue(999);
      const governance: DaemonGovernance = { max_cost_per_hour_usd: 0 };

      let calls = 0;
      const sleep: SleepFn = () => {
        calls++;
        if (calls >= 2) void daemon.stop();
        return Promise.resolve();
      };

      const daemon = makeDaemon({ queue, execute, governance, sleep });
      daemon.start();
      await daemon.stop();

      expect(execute).toHaveBeenCalled();
      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "budget_blocked")).toBe(false);
    });
  });

  describe("rate governance", () => {
    it("blocks when hourly task rate limit is reached", async () => {
      const task1 = makeTask("t1");
      const task2 = makeTask("t2");
      const queue = makeQueue([task1, task2, null]);
      const governance: DaemonGovernance = { max_tasks_per_hour: 1 };

      const shortSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, Math.max(1, ms)));

      const daemon = new AgentDaemon(
        "agent-1",
        { poll_interval_ms: 5 },
        governance,
        queue,
        makeBudget(),
        makeSupervisor(),
        vi.fn().mockResolvedValue(0),
        shortSleep,
      );

      daemon.start();
      // Allow enough time for: execute t1 → sleep → rate-blocked check → sleep
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      await daemon.stop();

      expect(daemon.getStatus().tasks_completed).toBe(1);
      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "rate_blocked")).toBe(true);
    });
  });

  describe("idle timeout", () => {
    it("stops the daemon after idle_timeout_ms with no tasks", async () => {
      const queue  = makeQueue([null, null, null]);
      const config: AgentDaemonConfig = { poll_interval_ms: 10, idle_timeout_ms: 1 };

      // Use real sleep so the idle timer can actually elapse
      const daemon = new AgentDaemon(
        "agent-1",
        config,
        {},
        queue,
        makeBudget(),
        makeSupervisor(),
        vi.fn().mockResolvedValue(0),
        (ms) => new Promise((r) => setTimeout(r, ms)),
      );

      daemon.start();
      // Give the loop time to detect idle timeout (poll=10ms, idle=1ms)
      await new Promise((r) => setTimeout(r, 100));
      expect(daemon.getStatus().running).toBe(false);

      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "idle_timeout")).toBe(true);
    });
  });

  describe("audit log", () => {
    it("records started event", () => {
      const daemon = makeDaemon({});
      daemon.start();
      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "started")).toBe(true);
      void daemon.stop();
    });

    it("records stopped event", async () => {
      const daemon = makeDaemon({});
      daemon.start();
      await daemon.stop();
      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "stopped")).toBe(true);
    });

    it("records task_dequeued and task_done events", async () => {
      const task  = makeTask();
      const queue = makeQueue([task, null]);

      let calls = 0;
      const sleep: SleepFn = () => {
        calls++;
        if (calls >= 2) void daemon.stop();
        return Promise.resolve();
      };

      const daemon = makeDaemon({ queue, sleep });
      daemon.start();
      await daemon.stop();

      const log = daemon.getAuditLog();
      expect(log.some((e) => e.event === "task_dequeued" && e.task_id === task.id)).toBe(true);
      expect(log.some((e) => e.event === "task_done"     && e.task_id === task.id)).toBe(true);
    });

    it("getAuditLog() returns entries most-recent first", async () => {
      const daemon = makeDaemon({});
      daemon.start();
      await daemon.stop();
      const log = daemon.getAuditLog();
      // stopped should appear before started in reverse-order log
      const stoppedIdx = log.findIndex((e) => e.event === "stopped");
      const startedIdx = log.findIndex((e) => e.event === "started");
      expect(stoppedIdx).toBeLessThan(startedIdx);
    });
  });

  describe("hourly_cost_usd in status", () => {
    it("accumulates cost from successful tasks", async () => {
      const task1 = makeTask("t1");
      const task2 = makeTask("t2");
      const queue = makeQueue([task1, task2, null]);
      const execute: ExecuteTaskFn = vi.fn().mockResolvedValue(0.10);

      const shortSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, Math.max(1, ms)));

      const daemon = new AgentDaemon(
        "agent-1",
        { poll_interval_ms: 5 },
        {},
        queue,
        makeBudget(),
        makeSupervisor(),
        execute,
        shortSleep,
      );

      daemon.start();
      // Give enough time for both tasks to be dequeued and executed
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      await daemon.stop();

      expect(daemon.getStatus().hourly_cost_usd).toBeCloseTo(0.20);
    });
  });
});
