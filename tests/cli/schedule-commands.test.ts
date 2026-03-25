// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/schedule.ts
 *
 * Covers:
 * - schedule list: shows all schedules
 * - schedule list --agent: filters by agent
 * - schedule list --division: filters by division
 * - schedule list --json: outputs JSON
 * - schedule create: creates schedule with valid args
 * - schedule create: errors on invalid cron
 * - schedule create: errors when division cannot be determined
 * - schedule enable: enables a disabled schedule
 * - schedule disable: disables an enabled schedule
 * - schedule delete --yes: removes schedule
 * - schedule delete (no --yes): prompts for confirmation
 * - schedule show: displays full schedule details
 * - schedule show --json: outputs JSON
 * - schedule history: shows execution history from TaskStore
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync }    from "node:fs";
import { tmpdir }                  from "node:os";
import { join }                    from "node:path";
import { Command }                 from "commander";
import { openDatabase }            from "../../src/utils/db.js";
import { CronScheduler }           from "../../src/scheduler/cron-scheduler.js";
import { TaskStore }               from "../../src/tasks/store.js";
import type { Database }           from "../../src/utils/db.js";
import type { SchedulingGovernance } from "../../src/scheduler/types.js";
import { registerScheduleCommands } from "../../src/cli/commands/schedule.js";
import { setGlobalLevel, resetLogger } from "../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Governance
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
    enabled: true, check_interval_ms: 60_000, warning_threshold_percent: 80,
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir:     string;
let db:         Database;
let scheduler:  CronScheduler;
let taskStore:  TaskStore;
let output:     string;

const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
const mockStdout = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
  output += String(s);
  return true;
});

beforeEach(async () => {
  tmpDir    = mkdtempSync(join(tmpdir(), "sched-cli-test-"));
  output    = "";
  db        = openDatabase(join(tmpDir, ".system", "sidjua.db"));
  scheduler = new CronScheduler(db, { canAfford: () => true }, GOVERNANCE);
  await scheduler.initialize();
  taskStore = new TaskStore(db);
  taskStore.initialize();
  setGlobalLevel("error"); // suppress debug/info logs so stdout stays clean for JSON parse
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
  output = "";
  resetLogger();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProgram(): Command {
  const prog = new Command().exitOverride();
  registerScheduleCommands(prog);
  return prog;
}

async function run(args: string[]): Promise<string> {
  output = "";
  const prog = makeProgram();
  try {
    await prog.parseAsync(["node", "sidjua", ...args]);
  } catch (_err) {
    // process.exit() throws — expected
  }
  return output;
}

// ---------------------------------------------------------------------------
// schedule list
// ---------------------------------------------------------------------------

describe("schedule list", () => {
  it("shows message when no schedules", async () => {
    const out = await run(["schedule", "list", "--work-dir", tmpDir]);
    expect(out).toContain("No schedules found");
  });

  it("shows all schedules in table format", async () => {
    scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "Heartbeat", priority: 5 },
    });
    const out = await run(["schedule", "list", "--work-dir", tmpDir]);
    expect(out).toContain("agent-1");
    expect(out).toContain("*/10 * * * *");
    expect(out).toContain("Heartbeat");
  });

  it("filters by --agent", async () => {
    scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "A1 task", priority: 5 },
    });
    scheduler.createSchedule({
      agent_id: "agent-2", division: "ops", cron_expression: "*/15 * * * *",
      task_template: { description: "A2 task", priority: 5 },
    });
    const out = await run(["schedule", "list", "--work-dir", tmpDir, "--agent", "agent-2"]);
    expect(out).toContain("agent-2");
    expect(out).not.toContain("agent-1");
  });

  it("filters by --division", async () => {
    scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "Eng task", priority: 5 },
    });
    scheduler.createSchedule({
      agent_id: "agent-2", division: "ops", cron_expression: "*/15 * * * *",
      task_template: { description: "Ops task", priority: 5 },
    });
    const out = await run(["schedule", "list", "--work-dir", tmpDir, "--division", "ops"]);
    expect(out).toContain("Ops task");
    expect(out).not.toContain("Eng task");
  });

  it("outputs JSON with --json", async () => {
    scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });
    const out = await run(["schedule", "list", "--work-dir", tmpDir, "--json"]);
    const parsed = JSON.parse(out) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// schedule create
// ---------------------------------------------------------------------------

describe("schedule create", () => {
  it("creates schedule and prints confirmation", async () => {
    // Insert agent so division can be looked up
    db.exec("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, division TEXT NOT NULL)");
    db.prepare("INSERT INTO agents (id, division) VALUES (?, ?)").run("agent-1", "engineering");

    const out = await run([
      "schedule", "create",
      "--work-dir", tmpDir,
      "--agent", "agent-1",
      "--cron", "*/10 * * * *",
      "--task", "Run heartbeat check",
    ]);
    expect(out).toContain("Schedule created:");
    expect(out).toContain("agent-1");
    expect(out).toContain("*/10 * * * *");
  });

  it("uses explicit --division when provided", async () => {
    const out = await run([
      "schedule", "create",
      "--work-dir", tmpDir,
      "--agent", "agent-x",
      "--division", "analytics",
      "--cron", "*/10 * * * *",
      "--task", "Analytics job",
    ]);
    expect(out).toContain("Schedule created:");
    expect(out).toContain("analytics");
  });

  it("errors when cron is invalid", async () => {
    const out = await run([
      "schedule", "create",
      "--work-dir", tmpDir,
      "--agent", "agent-x",
      "--division", "eng",
      "--cron", "bad-cron-expression",
      "--task", "Test",
    ]);
    expect(out).toContain("Error:");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("errors when division cannot be determined and --division not passed", async () => {
    const out = await run([
      "schedule", "create",
      "--work-dir", tmpDir,
      "--agent", "unknown-agent",
      "--cron", "*/10 * * * *",
      "--task", "Test",
    ]);
    expect(out).toContain("Error:");
    expect(out).toContain("division");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// schedule enable / disable
// ---------------------------------------------------------------------------

describe("schedule enable / disable", () => {
  it("enables a disabled schedule", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });
    scheduler.disableSchedule(sched.id);

    const out = await run(["schedule", "enable", sched.id, "--work-dir", tmpDir]);
    expect(out).toContain("enabled");
    expect(scheduler.getSchedule(sched.id)?.enabled).toBe(true);
  });

  it("disables an enabled schedule", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });

    const out = await run(["schedule", "disable", sched.id, "--work-dir", tmpDir]);
    expect(out).toContain("disabled");
    expect(scheduler.getSchedule(sched.id)?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// schedule delete
// ---------------------------------------------------------------------------

describe("schedule delete", () => {
  it("deletes schedule with --yes", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });

    const out = await run(["schedule", "delete", sched.id, "--yes", "--work-dir", tmpDir]);
    expect(out).toContain("deleted");
    expect(scheduler.getSchedule(sched.id)).toBeNull();
  });

  it("shows confirmation prompt without --yes", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });

    const out = await run(["schedule", "delete", sched.id, "--work-dir", tmpDir]);
    expect(out).toContain("--yes");
    // Schedule should still exist
    expect(scheduler.getSchedule(sched.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// schedule show
// ---------------------------------------------------------------------------

describe("schedule show", () => {
  it("shows full schedule details", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "engineering", cron_expression: "*/10 * * * *",
      task_template: { description: "Heartbeat check", priority: 3, budget_usd: 0.5 },
      governance: { max_runs_per_day: 5, require_approval: true },
    });

    const out = await run(["schedule", "show", sched.id, "--work-dir", tmpDir]);
    expect(out).toContain(sched.id);
    expect(out).toContain("agent-1");
    expect(out).toContain("engineering");
    expect(out).toContain("*/10 * * * *");
    expect(out).toContain("Heartbeat check");
    expect(out).toContain("0.5"); // budget_usd
    expect(out).toContain("5");   // max_runs_per_day
    expect(out).toContain("true"); // require_approval
  });

  it("shows JSON with --json flag", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });
    const out = await run(["schedule", "show", sched.id, "--json", "--work-dir", tmpDir]);
    const parsed = JSON.parse(out) as { id: string };
    expect(parsed.id).toBe(sched.id);
  });

  it("errors for unknown schedule id", async () => {
    await run(["schedule", "show", "nonexistent-id", "--work-dir", tmpDir]);
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(output).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// schedule history
// ---------------------------------------------------------------------------

describe("schedule history", () => {
  it("shows no executions message when empty", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });
    const out = await run(["schedule", "history", sched.id, "--work-dir", tmpDir]);
    expect(out).toContain("No executions found");
  });

  it("shows execution history from TaskStore", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });
    // Create a recurring task linked to this schedule
    taskStore.create({
      title: "[recurring] HB", description: "HB",
      division: "eng", type: "root", tier: 2,
      token_budget: 1000, cost_budget: 1.0,
      recurring_schedule_id: sched.id, is_recurring: true,
    });

    const out = await run(["schedule", "history", sched.id, "--work-dir", tmpDir]);
    expect(out).toContain("CREATED");
  });

  it("outputs JSON history with --json", async () => {
    const sched = scheduler.createSchedule({
      agent_id: "agent-1", division: "eng", cron_expression: "*/10 * * * *",
      task_template: { description: "HB", priority: 5 },
    });
    taskStore.create({
      title: "[recurring] HB", description: "HB",
      division: "eng", type: "root", tier: 2,
      token_budget: 1000, cost_budget: 1.0,
      recurring_schedule_id: sched.id, is_recurring: true,
    });

    const out = await run(["schedule", "history", sched.id, "--json", "--work-dir", tmpDir]);
    const parsed = JSON.parse(out) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });
});

// Suppress unused var warning
void mockExit;
void mockStdout;
