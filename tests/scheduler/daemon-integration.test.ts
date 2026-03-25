// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for AgentDaemon ↔ CronScheduler + DeadlineWatcher integration
 *
 * Covers:
 * - Daemon loop calls _runSchedulerStep on each iteration
 * - Due schedule triggers task submission (recurring_schedule_id + is_recurring)
 * - Budget-exhausted schedule emits BUDGET_EXHAUSTED event
 * - Approval-required schedule on first run does NOT create a task
 * - Completed recurring task updates schedule cost via updateScheduleCost
 * - DeadlineWatcher escalations emitted via TaskEventBus
 * - No crash when executeDueSchedule throws
 * - No scheduler step when schedulerServices is undefined
 */

import { describe, it, expect, vi } from "vitest";
import { AgentDaemon } from "../../src/agent-lifecycle/agent-daemon.js";
import type { SchedulerServices } from "../../src/agent-lifecycle/agent-daemon.js";
import type { Task } from "../../src/tasks/types.js";
import type { ScheduleDefinition, EscalationEvent } from "../../src/scheduler/types.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSchedule(overrides: Partial<ScheduleDefinition> = {}): ScheduleDefinition {
  return {
    id:              "sched-1",
    agent_id:        "agent-1",
    division:        "eng",
    cron_expression: "*/5 * * * *",
    task_template:   { description: "Heartbeat", priority: 5, budget_usd: 0.5 },
    enabled:         true,
    governance:      { max_cost_per_run: 1.0, max_runs_per_day: 24, require_approval: false },
    last_run_at:     null,
    next_run_at:     new Date(Date.now() - 1000).toISOString(), // overdue
    total_runs:      0,
    total_cost_usd:  0.0,
    ...overrides,
  };
}

function makeRecurringTask(scheduleId: string): Task {
  return {
    id: "task-recurring-1", parent_id: null, root_id: "task-recurring-1",
    division: "eng", type: "root", tier: 2,
    title: "[recurring] Heartbeat", description: "Heartbeat",
    assigned_agent: "agent-1", status: "CREATED", priority: 5, classification: "internal",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    started_at: null, completed_at: null, result_file: null, result_summary: null,
    confidence: null, token_budget: 8000, token_used: 0, cost_budget: 0.5, cost_used: 0.0,
    ttl_seconds: 600, retry_count: 0, max_retries: 3, checkpoint: null,
    sub_tasks_expected: 0, sub_tasks_received: 0, embedding_id: null, metadata: {},
    recurring_schedule_id: scheduleId, is_recurring: true,
  };
}

function makeNormalTask(): Task {
  return {
    id: "task-normal-1", parent_id: null, root_id: "task-normal-1",
    division: "eng", type: "root", tier: 1,
    title: "Normal task", description: "Normal",
    assigned_agent: "agent-1", status: "CREATED", priority: 5, classification: "internal",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    started_at: null, completed_at: null, result_file: null, result_summary: null,
    confidence: null, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0.0,
    ttl_seconds: 3600, retry_count: 0, max_retries: 3, checkpoint: null,
    sub_tasks_expected: 0, sub_tasks_received: 0, embedding_id: null, metadata: {},
    recurring_schedule_id: null, is_recurring: false,
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Stubs {
  queue:           { dequeue: ReturnType<typeof vi.fn> };
  budget:          { getHourlySpend: ReturnType<typeof vi.fn>; recordCost: ReturnType<typeof vi.fn> };
  supervisor:      { recordHeartbeat: ReturnType<typeof vi.fn>; getAgentStatus: ReturnType<typeof vi.fn> };
  execute:         ReturnType<typeof vi.fn>;
  sleep:           ReturnType<typeof vi.fn>;
  scheduler: {
    getDueTasks:        ReturnType<typeof vi.fn>;
    executeDueSchedule: ReturnType<typeof vi.fn>;
    updateScheduleCost: ReturnType<typeof vi.fn>;
  };
  taskStore:       { create: ReturnType<typeof vi.fn> };
  eventBus:        { emitTask: ReturnType<typeof vi.fn> };
  deadlineWatcher: { checkAll: ReturnType<typeof vi.fn> };
}

function makeStubs(schedules: ScheduleDefinition[] = []): Stubs {
  return {
    queue: { dequeue: vi.fn(() => null) },
    budget: {
      getHourlySpend: vi.fn(() => 0),
      recordCost:     vi.fn(),
    },
    supervisor: {
      recordHeartbeat: vi.fn(),
      getAgentStatus:  vi.fn(() => ({ circuit_open: false })),
    },
    execute:   vi.fn(async () => 0.1),
    sleep:     vi.fn(async () => undefined),
    scheduler: {
      getDueTasks:        vi.fn((_agentId: string, _now: Date) => [...schedules]),
      executeDueSchedule: vi.fn(async () => ({ executed: true })),
      updateScheduleCost: vi.fn(),
    },
    taskStore: {
      create: vi.fn(() => makeRecurringTask("sched-1")),
    },
    eventBus: {
      emitTask: vi.fn(async () => undefined),
    },
    deadlineWatcher: {
      checkAll: vi.fn((_now: Date): EscalationEvent[] => []),
    },
  };
}

function makeSchedulerServices(stubs: Stubs): SchedulerServices {
  return {
    cronScheduler:   stubs.scheduler as never,
    deadlineWatcher: stubs.deadlineWatcher as never,
    taskStore:       stubs.taskStore as never,
    eventBus:        stubs.eventBus as never,
    agentDivision:   "eng",
  };
}

/** Build a daemon, wire sleep to stop the loop after first idle, start it, and wait. */
async function runDaemon(
  stubs: Stubs,
  svc: SchedulerServices | undefined,
  firstTask: Task | null = makeNormalTask(),
): Promise<AgentDaemon> {
  const daemon = new AgentDaemon(
    "agent-1",
    { poll_interval_ms: 10, max_concurrent: 1 },
    {},
    stubs.queue as never,
    stubs.budget as never,
    stubs.supervisor as never,
    stubs.execute as never,
    stubs.sleep as never,
    undefined,
    undefined,
    svc,
  );

  // Provide one task, then null; sleep stops the loop by setting running=false
  let dequeued = false;
  stubs.queue.dequeue.mockImplementation(() => {
    if (!dequeued && firstTask !== null) {
      dequeued = true;
      return firstTask;
    }
    return null;
  });
  stubs.sleep.mockImplementation(async () => {
    // Stop daemon so the loop exits on next iteration check
    daemon["running"] = false;
  });

  daemon.start();
  // Allow microtasks + timers to flush
  await new Promise<void>((r) => setTimeout(r, 60));
  return daemon;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getDueTasks called each iteration", () => {
  it("calls getDueTasks after processing a task", async () => {
    const stubs = makeStubs();
    const svc   = makeSchedulerServices(stubs);

    await runDaemon(stubs, svc, makeNormalTask());

    expect(stubs.scheduler.getDueTasks).toHaveBeenCalled();
  });
});

describe("due schedule submits task", () => {
  it("creates a task in taskStore when schedule is due and executed=true", async () => {
    const schedule = makeSchedule();
    const stubs    = makeStubs([schedule]);
    const svc      = makeSchedulerServices(stubs);

    stubs.scheduler.executeDueSchedule.mockResolvedValue({ executed: true });

    await runDaemon(stubs, svc, makeNormalTask());

    expect(stubs.taskStore.create).toHaveBeenCalledOnce();
    const arg = stubs.taskStore.create.mock.calls[0][0] as Record<string, unknown>;
    expect(arg["recurring_schedule_id"]).toBe("sched-1");
    expect(arg["is_recurring"]).toBe(true);
    expect(String(arg["title"])).toMatch(/\[recurring\]/);
  });

  it("emits TASK_CREATED via eventBus after task creation", async () => {
    const schedule = makeSchedule();
    const stubs    = makeStubs([schedule]);
    const svc      = makeSchedulerServices(stubs);

    stubs.scheduler.executeDueSchedule.mockResolvedValue({ executed: true });

    await runDaemon(stubs, svc, makeNormalTask());

    expect(stubs.eventBus.emitTask).toHaveBeenCalledOnce();
    const arg = stubs.eventBus.emitTask.mock.calls[0][0] as Record<string, unknown>;
    expect(arg["event_type"]).toBe("TASK_CREATED");
  });
});

describe("budget exhausted schedule", () => {
  it("emits BUDGET_EXHAUSTED and does NOT create a task", async () => {
    const schedule = makeSchedule();
    const stubs    = makeStubs([schedule]);
    const svc      = makeSchedulerServices(stubs);

    stubs.scheduler.executeDueSchedule.mockResolvedValue({
      executed: false,
      reason:   "budget_exhausted",
    });

    await runDaemon(stubs, svc, makeNormalTask());

    expect(stubs.taskStore.create).not.toHaveBeenCalled();
    expect(stubs.eventBus.emitTask).toHaveBeenCalledOnce();
    const arg = stubs.eventBus.emitTask.mock.calls[0][0] as Record<string, unknown>;
    expect(arg["event_type"]).toBe("BUDGET_EXHAUSTED");
  });
});

describe("approval-required schedule", () => {
  it("does NOT create a task or emit events when requires_approval", async () => {
    const schedule = makeSchedule();
    const stubs    = makeStubs([schedule]);
    const svc      = makeSchedulerServices(stubs);

    stubs.scheduler.executeDueSchedule.mockResolvedValue({
      executed: false,
      reason:   "requires_approval",
    });

    await runDaemon(stubs, svc, makeNormalTask());

    expect(stubs.taskStore.create).not.toHaveBeenCalled();
    expect(stubs.eventBus.emitTask).not.toHaveBeenCalled();
  });
});

describe("updateScheduleCost on recurring task completion", () => {
  it("calls updateScheduleCost with cost after recurring task finishes", async () => {
    const stubs = makeStubs([]);
    const svc   = makeSchedulerServices(stubs);

    stubs.execute.mockResolvedValue(0.25);

    await runDaemon(stubs, svc, makeRecurringTask("sched-1"));

    expect(stubs.scheduler.updateScheduleCost).toHaveBeenCalledWith("sched-1", 0.25);
  });

  it("does NOT call updateScheduleCost for non-recurring tasks", async () => {
    const stubs = makeStubs([]);
    const svc   = makeSchedulerServices(stubs);

    stubs.execute.mockResolvedValue(0.1);

    await runDaemon(stubs, svc, makeNormalTask());

    expect(stubs.scheduler.updateScheduleCost).not.toHaveBeenCalled();
  });
});

describe("DeadlineWatcher escalation events", () => {
  it("emits BUDGET_EXHAUSTED for budget_exhausted escalations", async () => {
    const stubs = makeStubs([]);
    const svc   = makeSchedulerServices(stubs);

    const escalation: EscalationEvent = {
      task_id:   "task-abc",
      type:      "budget_exhausted",
      severity:  "critical",
      details:   "Cost exceeded",
      timestamp: new Date().toISOString(),
    };
    stubs.deadlineWatcher.checkAll.mockReturnValue([escalation]);

    await runDaemon(stubs, svc, makeNormalTask());

    const budgetCall = stubs.eventBus.emitTask.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)["event_type"] === "BUDGET_EXHAUSTED",
    );
    expect(budgetCall).toBeDefined();
  });

  it("emits TTL_WARNING for approaching_deadline escalations", async () => {
    const stubs = makeStubs([]);
    const svc   = makeSchedulerServices(stubs);

    const escalation: EscalationEvent = {
      task_id:   "task-xyz",
      type:      "approaching_deadline",
      severity:  "warning",
      details:   "80% of TTL elapsed",
      timestamp: new Date().toISOString(),
    };
    stubs.deadlineWatcher.checkAll.mockReturnValue([escalation]);

    await runDaemon(stubs, svc, makeNormalTask());

    const ttlCall = stubs.eventBus.emitTask.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)["event_type"] === "TTL_WARNING",
    );
    expect(ttlCall).toBeDefined();
  });
});

describe("no schedulerServices", () => {
  it("skips getDueTasks and eventBus when schedulerServices is undefined", async () => {
    const stubs = makeStubs([]);

    await runDaemon(stubs, undefined, makeNormalTask());

    expect(stubs.scheduler.getDueTasks).not.toHaveBeenCalled();
    expect(stubs.eventBus.emitTask).not.toHaveBeenCalled();
  });
});

describe("executeDueSchedule throws", () => {
  it("continues without crashing and does not create a task", async () => {
    const schedule = makeSchedule();
    const stubs    = makeStubs([schedule]);
    const svc      = makeSchedulerServices(stubs);

    stubs.scheduler.executeDueSchedule.mockRejectedValue(new Error("cron parse failure"));

    await runDaemon(stubs, svc, makeNormalTask());

    expect(stubs.taskStore.create).not.toHaveBeenCalled();
  });
});
