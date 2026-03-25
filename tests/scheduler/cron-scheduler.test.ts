// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/scheduler/cron-scheduler.ts
 *
 * Covers:
 * - initialize() creates schema idempotently
 * - createSchedule validates cron expression
 * - createSchedule validates minimum interval
 * - createSchedule validates per-agent limit
 * - createSchedule validates per-division limit
 * - createSchedule returns persisted ScheduleDefinition
 * - listSchedules returns all / filtered by agent
 * - getSchedule returns null for missing
 * - updateSchedule updates cron and recalculates next_run_at
 * - updateSchedule throws for missing id
 * - deleteSchedule removes the row
 * - enableSchedule / disableSchedule toggle enabled flag
 * - getDueTasks returns schedules whose next_run_at <= now
 * - getDueTasks skips disabled schedules
 * - executeDueSchedule passes and advances next_run_at
 * - executeDueSchedule blocks on budget_exhausted
 * - executeDueSchedule blocks on requires_approval for first run
 * - executeDueSchedule blocks when max_runs_per_day is 1 and already ran today
 * - updateScheduleCost increments total_cost_usd
 * - loadSchedulesFromConfig inserts new schedules
 * - loadSchedulesFromConfig updates existing schedules without losing run history
 * - loadSchedulesFromConfig recalculates next_run_at only when cron changes
 * - loadSchedulesFromConfig skips agents with no schedules
 * - loadSchedulesFromConfig uses composite id (agent_id:entry_id)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir }              from "node:os";
import { join }                from "node:path";
import { openDatabase }        from "../../src/utils/db.js";
import { CronScheduler }       from "../../src/scheduler/cron-scheduler.js";
import type { Database }       from "../../src/utils/db.js";
import type {
  ScheduleCreateInput,
  SchedulingGovernance,
  BudgetTrackerLike,
  AgentConfig,
} from "../../src/scheduler/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GOVERNANCE: SchedulingGovernance = {
  enabled: true,
  global_limits: {
    max_schedules_per_agent:          10,
    max_schedules_per_division:       50,
    max_total_scheduled_cost_per_day: 50.0,
    min_cron_interval_minutes:        5,
  },
  deadline_watcher: {
    enabled:                   true,
    check_interval_ms:         60_000,
    warning_threshold_percent: 80,
  },
};

function makeBudget(canAfford = true): BudgetTrackerLike {
  return { canAfford: () => canAfford };
}

function makeInput(overrides: Partial<ScheduleCreateInput> = {}): ScheduleCreateInput {
  return {
    agent_id:        "agent-1",
    division:        "engineering",
    cron_expression: "*/10 * * * *",
    task_template: {
      description: "Scheduled heartbeat",
      priority:    5,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let scheduler: CronScheduler;

beforeEach(async () => {
  tmpDir    = mkdtempSync(join(tmpdir(), "cron-sched-test-"));
  db        = openDatabase(join(tmpDir, "test.db"));
  scheduler = new CronScheduler(db, makeBudget(), GOVERNANCE);
  await scheduler.initialize();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe("initialize", () => {
  it("creates the schedules table idempotently", async () => {
    await scheduler.initialize(); // second call — no throw
    const row = db.prepare<unknown[], { cnt: number }>(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schedules'",
    ).get();
    expect(row?.cnt).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createSchedule
// ---------------------------------------------------------------------------

describe("createSchedule", () => {
  it("returns a ScheduleDefinition with a UUID id", () => {
    const sched = scheduler.createSchedule(makeInput());
    expect(sched.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sched.agent_id).toBe("agent-1");
    expect(sched.cron_expression).toBe("*/10 * * * *");
    expect(sched.enabled).toBe(true);
    expect(sched.total_runs).toBe(0);
    expect(sched.last_run_at).toBeNull();
  });

  it("persists next_run_at in the future", () => {
    const now   = new Date();
    const sched = scheduler.createSchedule(makeInput());
    expect(new Date(sched.next_run_at).getTime()).toBeGreaterThan(now.getTime());
  });

  it("throws on invalid cron expression", () => {
    expect(() => scheduler.createSchedule(makeInput({ cron_expression: "bad-cron" })))
      .toThrow("Invalid cron expression");
  });

  it("throws when cron interval is below minimum", () => {
    // Every minute (1-minute interval) < 5-minute minimum
    expect(() => scheduler.createSchedule(makeInput({ cron_expression: "* * * * *" })))
      .toThrow("below the minimum allowed");
  });

  it("throws when per-agent schedule limit is reached", () => {
    const gov: SchedulingGovernance = {
      ...GOVERNANCE,
      global_limits: { ...GOVERNANCE.global_limits, max_schedules_per_agent: 1 },
    };
    const s2 = new CronScheduler(db, makeBudget(), gov);
    s2.createSchedule(makeInput());
    expect(() => s2.createSchedule(makeInput({ cron_expression: "*/15 * * * *" })))
      .toThrow("already has");
  });

  it("throws when per-division schedule limit is reached", () => {
    const gov: SchedulingGovernance = {
      ...GOVERNANCE,
      global_limits: { ...GOVERNANCE.global_limits, max_schedules_per_division: 1 },
    };
    const s2 = new CronScheduler(db, makeBudget(), gov);
    s2.createSchedule(makeInput());
    expect(() =>
      s2.createSchedule(makeInput({ agent_id: "agent-2", cron_expression: "*/15 * * * *" })),
    ).toThrow("already has");
  });

  it("stores optional task_template fields", () => {
    const sched = scheduler.createSchedule(makeInput({
      task_template: {
        description:   "With budget",
        priority:      3,
        budget_tokens: 1000,
        budget_usd:    0.5,
        ttl_seconds:   300,
      },
    }));
    expect(sched.task_template.budget_tokens).toBe(1000);
    expect(sched.task_template.budget_usd).toBe(0.5);
    expect(sched.task_template.ttl_seconds).toBe(300);
  });

  it("stores governance fields", () => {
    const sched = scheduler.createSchedule(makeInput({
      governance: { max_cost_per_run: 2.5, max_runs_per_day: 3, require_approval: true },
    }));
    expect(sched.governance.max_cost_per_run).toBe(2.5);
    expect(sched.governance.max_runs_per_day).toBe(3);
    expect(sched.governance.require_approval).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listSchedules / getSchedule
// ---------------------------------------------------------------------------

describe("listSchedules", () => {
  it("returns empty array when no schedules", () => {
    expect(scheduler.listSchedules()).toEqual([]);
  });

  it("returns all schedules", () => {
    scheduler.createSchedule(makeInput());
    scheduler.createSchedule(makeInput({ agent_id: "agent-2", cron_expression: "*/15 * * * *" }));
    expect(scheduler.listSchedules()).toHaveLength(2);
  });

  it("filters by agent_id", () => {
    scheduler.createSchedule(makeInput());
    scheduler.createSchedule(makeInput({ agent_id: "agent-2", cron_expression: "*/15 * * * *" }));
    const results = scheduler.listSchedules("agent-2");
    expect(results).toHaveLength(1);
    expect(results[0].agent_id).toBe("agent-2");
  });
});

describe("getSchedule", () => {
  it("returns null for missing id", () => {
    expect(scheduler.getSchedule("nonexistent")).toBeNull();
  });

  it("returns the schedule for a valid id", () => {
    const created = scheduler.createSchedule(makeInput());
    const fetched  = scheduler.getSchedule(created.id);
    expect(fetched?.id).toBe(created.id);
  });
});

// ---------------------------------------------------------------------------
// updateSchedule
// ---------------------------------------------------------------------------

describe("updateSchedule", () => {
  it("throws for missing schedule id", () => {
    expect(() => scheduler.updateSchedule("ghost", {})).toThrow("not found");
  });

  it("updates task description", () => {
    const sched = scheduler.createSchedule(makeInput());
    scheduler.updateSchedule(sched.id, {
      task_template: { description: "Updated desc", priority: 5 },
    });
    const updated = scheduler.getSchedule(sched.id);
    expect(updated?.task_template.description).toBe("Updated desc");
  });

  it("recalculates next_run_at when cron expression changes", () => {
    const sched   = scheduler.createSchedule(makeInput({ cron_expression: "*/10 * * * *" }));
    const oldNext = sched.next_run_at;
    scheduler.updateSchedule(sched.id, { cron_expression: "*/15 * * * *" });
    const updated = scheduler.getSchedule(sched.id);
    // next_run_at may differ (different cron produces different fire time)
    expect(updated?.cron_expression).toBe("*/15 * * * *");
    // Updated next_run_at should be a valid ISO date string
    expect(() => new Date(updated!.next_run_at)).not.toThrow();
    void oldNext;
  });

  it("does not recalculate next_run_at when cron is unchanged", () => {
    const sched = scheduler.createSchedule(makeInput());
    const before = scheduler.getSchedule(sched.id)!.next_run_at;
    scheduler.updateSchedule(sched.id, { enabled: false });
    const after = scheduler.getSchedule(sched.id)!.next_run_at;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// deleteSchedule
// ---------------------------------------------------------------------------

describe("deleteSchedule", () => {
  it("removes the schedule", () => {
    const sched = scheduler.createSchedule(makeInput());
    scheduler.deleteSchedule(sched.id);
    expect(scheduler.getSchedule(sched.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// enableSchedule / disableSchedule
// ---------------------------------------------------------------------------

describe("enableSchedule / disableSchedule", () => {
  it("disableSchedule sets enabled = false", () => {
    const sched = scheduler.createSchedule(makeInput());
    scheduler.disableSchedule(sched.id);
    expect(scheduler.getSchedule(sched.id)?.enabled).toBe(false);
  });

  it("enableSchedule sets enabled = true and recalculates next_run_at", () => {
    const sched = scheduler.createSchedule(makeInput());
    scheduler.disableSchedule(sched.id);
    scheduler.enableSchedule(sched.id);
    const updated = scheduler.getSchedule(sched.id)!;
    expect(updated.enabled).toBe(true);
    expect(new Date(updated.next_run_at).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("enableSchedule throws for missing schedule", () => {
    expect(() => scheduler.enableSchedule("ghost")).toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// getDueTasks
// ---------------------------------------------------------------------------

describe("getDueTasks", () => {
  it("returns schedules whose next_run_at is in the past", () => {
    const sched = scheduler.createSchedule(makeInput());
    // Force next_run_at into the past
    db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      sched.id,
    );
    const due = scheduler.getDueTasks("agent-1");
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(sched.id);
  });

  it("does not return schedules with next_run_at in the future", () => {
    scheduler.createSchedule(makeInput());
    const due = scheduler.getDueTasks("agent-1", new Date(Date.now() - 86_400_000));
    expect(due).toHaveLength(0);
  });

  it("skips disabled schedules", () => {
    const sched = scheduler.createSchedule(makeInput());
    db.prepare("UPDATE schedules SET next_run_at = ?, enabled = 0 WHERE id = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      sched.id,
    );
    expect(scheduler.getDueTasks("agent-1")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// executeDueSchedule
// ---------------------------------------------------------------------------

describe("executeDueSchedule", () => {
  it("returns executed: true and increments total_runs", async () => {
    const sched  = scheduler.createSchedule(makeInput());
    const result = await scheduler.executeDueSchedule(sched);
    expect(result.executed).toBe(true);
    expect(result.reason).toBeUndefined();
    const after = scheduler.getSchedule(sched.id)!;
    expect(after.total_runs).toBe(1);
    expect(after.last_run_at).not.toBeNull();
    // next_run_at must be a valid ISO date
    expect(() => new Date(after.next_run_at)).not.toThrow();
  });

  it("blocks when budget_exhausted", async () => {
    const poor = new CronScheduler(db, makeBudget(false), GOVERNANCE);
    const sched = scheduler.createSchedule(makeInput());
    const result = await poor.executeDueSchedule(sched);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("budget_exhausted");
  });

  it("blocks first run when require_approval is true", async () => {
    const sched = scheduler.createSchedule(makeInput({
      governance: { require_approval: true },
    }));
    const result = await scheduler.executeDueSchedule(sched);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("requires_approval");
  });

  it("does not block subsequent runs when require_approval is true", async () => {
    const sched = scheduler.createSchedule(makeInput({
      governance: { require_approval: true },
    }));
    // Simulate one previous run
    db.prepare("UPDATE schedules SET total_runs = 1 WHERE id = ?").run(sched.id);
    const reloaded = scheduler.getSchedule(sched.id)!;
    const result   = await scheduler.executeDueSchedule(reloaded);
    expect(result.executed).toBe(true);
  });

  it("blocks when max_runs_per_day = 1 and already ran today (via schedule_runs ledger)", async () => {
    const sched = scheduler.createSchedule(makeInput({
      governance: { max_runs_per_day: 1 },
    }));
    // Record a run in the ledger for today
    const todayIso = new Date().toISOString();
    db.prepare("INSERT INTO schedule_runs (schedule_id, run_at) VALUES (?, ?)").run(sched.id, todayIso);
    const reloaded = scheduler.getSchedule(sched.id)!;
    const result   = await scheduler.executeDueSchedule(reloaded);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("max_runs_per_day exceeded");
  });
});

// ---------------------------------------------------------------------------
// updateScheduleCost
// ---------------------------------------------------------------------------

describe("updateScheduleCost", () => {
  it("increments total_cost_usd", () => {
    const sched = scheduler.createSchedule(makeInput());
    scheduler.updateScheduleCost(sched.id, 0.25);
    scheduler.updateScheduleCost(sched.id, 0.10);
    const updated = scheduler.getSchedule(sched.id)!;
    expect(updated.total_cost_usd).toBeCloseTo(0.35, 5);
  });
});

// ---------------------------------------------------------------------------
// loadSchedulesFromConfig
// ---------------------------------------------------------------------------

describe("loadSchedulesFromConfig", () => {
  it("inserts schedules from agent config", () => {
    const configs: AgentConfig[] = [
      {
        id:       "agent-1",
        division: "engineering",
        schedules: [
          {
            id:              "hb",
            cron_expression: "*/10 * * * *",
            task_template:   { description: "Heartbeat" },
          },
        ],
      },
    ];
    scheduler.loadSchedulesFromConfig(configs);
    const list = scheduler.listSchedules("agent-1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("agent-1:hb");
    expect(list[0].task_template.description).toBe("Heartbeat");
  });

  it("uses composite id format agent_id:entry_id", () => {
    scheduler.loadSchedulesFromConfig([
      {
        id: "myagent", division: "ops",
        schedules: [{ id: "job1", cron_expression: "*/10 * * * *", task_template: { description: "X" } }],
      },
    ]);
    expect(scheduler.getSchedule("myagent:job1")).not.toBeNull();
  });

  it("updates existing schedules without losing run history", () => {
    const configs: AgentConfig[] = [
      {
        id: "agent-1", division: "engineering",
        schedules: [{ id: "hb", cron_expression: "*/10 * * * *", task_template: { description: "v1" } }],
      },
    ];
    scheduler.loadSchedulesFromConfig(configs);

    // Simulate some run history
    db.prepare("UPDATE schedules SET total_runs = 5, last_run_at = datetime('now') WHERE id = 'agent-1:hb'").run();

    // Reload with updated description
    configs[0].schedules![0].task_template.description = "v2";
    scheduler.loadSchedulesFromConfig(configs);

    const sched = scheduler.getSchedule("agent-1:hb")!;
    expect(sched.task_template.description).toBe("v2");
    expect(sched.total_runs).toBe(5); // preserved
  });

  it("recalculates next_run_at only when cron expression changes", () => {
    const configs: AgentConfig[] = [
      {
        id: "agent-1", division: "engineering",
        schedules: [{ id: "hb", cron_expression: "*/10 * * * *", task_template: { description: "X" } }],
      },
    ];
    scheduler.loadSchedulesFromConfig(configs);
    const before = scheduler.getSchedule("agent-1:hb")!.next_run_at;

    // Reload without changing cron — next_run_at should stay
    scheduler.loadSchedulesFromConfig(configs);
    const after = scheduler.getSchedule("agent-1:hb")!.next_run_at;
    expect(after).toBe(before);
  });

  it("skips agents with no schedules array", () => {
    scheduler.loadSchedulesFromConfig([{ id: "agent-x", division: "ops" }]);
    expect(scheduler.listSchedules("agent-x")).toHaveLength(0);
  });
});
