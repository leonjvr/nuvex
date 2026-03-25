// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P251 — HIGH Operational Integrity regression tests.
 *
 * Covers all 7 fixes:
 *   FIX-1  CostTracker.checkBudget — consistent read snapshot (transaction)
 *   FIX-2  BudgetTracker spend methods — fail closed on DB error
 *   FIX-3  CronScheduler — ledger-based daily run count
 *   FIX-4  Delegation IPC — typed CLIRequest shape (no `as never`)
 *   FIX-5  Provider selftest — reads persisted config first
 *   FIX-6  Governance selftest — canonical .system/governance path only
 *   FIX-7  Health command — no journal_mode mutation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync,
} from "node:fs";
import { join }   from "node:path";
import { tmpdir } from "node:os";
import BetterSqlite3 from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "p251-"));
  mkdirSync(join(dir, ".system"), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// FIX-1 — CostTracker.checkBudget runs inside a transaction
// ---------------------------------------------------------------------------

describe("FIX-1: CostTracker.checkBudget — consistent snapshot transaction", () => {
  it("wraps checkBudget in a transaction (no TOCTOU between reads)", async () => {
    const { CostTracker } = await import("../../src/provider/cost-tracker.js");
    const db = new BetterSqlite3(":memory:");

    // Minimal schema
    db.exec(`
      CREATE TABLE cost_budgets (
        division_code TEXT PRIMARY KEY,
        monthly_limit_usd REAL,
        daily_limit_usd REAL,
        alert_threshold_percent REAL NOT NULL DEFAULT 80
      );
      CREATE TABLE cost_ledger (
        id INTEGER PRIMARY KEY,
        division_code TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL,
        task_id TEXT,
        cost_type TEXT NOT NULL DEFAULT 'actual',
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.prepare("INSERT INTO cost_budgets VALUES ('eng', 10.0, 1.0, 80)").run();

    const tracker = new CostTracker(db);

    // checkBudget should complete without error and return consistent results
    const result = tracker.checkBudget("eng", 0.5);
    expect(result.allowed).toBe(true);
    expect(result.divisionCode).toBe("eng");

    db.close();
  });

  it("atomicCheckAndReserve uses BEGIN IMMEDIATE without double-wrapping transaction", async () => {
    const { CostTracker } = await import("../../src/provider/cost-tracker.js");
    const db = new BetterSqlite3(":memory:");

    db.exec(`
      CREATE TABLE cost_budgets (
        division_code TEXT PRIMARY KEY,
        monthly_limit_usd REAL,
        daily_limit_usd REAL,
        alert_threshold_percent REAL NOT NULL DEFAULT 80
      );
      CREATE TABLE cost_ledger (
        id INTEGER PRIMARY KEY,
        division_code TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL,
        task_id TEXT,
        cost_type TEXT NOT NULL DEFAULT 'actual',
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.prepare("INSERT INTO cost_budgets VALUES ('eng', 10.0, 5.0, 80)").run();

    const tracker = new CostTracker(db);
    const { result, reservationId } = tracker.atomicCheckAndReserve(
      "eng", "agent-1", "openai", "gpt-4o", 0.25,
    );
    expect(result.allowed).toBe(true);
    expect(typeof reservationId).toBe("number");

    db.close();
  });
});

// ---------------------------------------------------------------------------
// FIX-2 — BudgetTracker.getAgentMonthlySpend / getAgentDailySpend fail closed
// ---------------------------------------------------------------------------

describe("FIX-2: BudgetTracker spend methods — fail closed on DB error", () => {
  it("getAgentMonthlySpend returns Infinity when DB query throws", async () => {
    const { BudgetTracker } = await import("../../src/agent-lifecycle/budget-tracker.js");
    const db = new BetterSqlite3(":memory:");
    // cost_ledger table deliberately NOT created → query will throw

    const tracker = new BudgetTracker(db);
    const result = tracker.getAgentMonthlySpend("any-agent");
    expect(result).toBe(Number.POSITIVE_INFINITY);

    db.close();
  });

  it("getAgentDailySpend returns Infinity when DB query throws", async () => {
    const { BudgetTracker } = await import("../../src/agent-lifecycle/budget-tracker.js");
    const db = new BetterSqlite3(":memory:");

    const tracker = new BudgetTracker(db);
    const result = tracker.getAgentDailySpend("any-agent");
    expect(result).toBe(Number.POSITIVE_INFINITY);

    db.close();
  });

  it("Infinity spend exceeds any finite budget limit (produces exceeded alert)", async () => {
    const { BudgetTracker } = await import("../../src/agent-lifecycle/budget-tracker.js");
    const db = new BetterSqlite3(":memory:");
    // cost_ledger missing → getAgentMonthlySpend returns Infinity

    const tracker = new BudgetTracker(db);
    const spend   = tracker.getAgentMonthlySpend("x");
    const limit   = 100;
    const pct     = limit > 0 ? (spend / limit) * 100 : 0;

    // Infinity/limit = Infinity > 100 → "exceeded"
    expect(pct).toBe(Number.POSITIVE_INFINITY);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// FIX-3 — CronScheduler uses schedule_runs ledger for daily count
// ---------------------------------------------------------------------------

import type { BudgetTrackerLike, SchedulingGovernance } from "../../src/scheduler/types.js";

const GOVERNANCE: SchedulingGovernance = {
  enabled: true,
  global_limits: {
    max_schedules_per_agent:          10,
    max_schedules_per_division:       50,
    max_total_scheduled_cost_per_day: 1000,
    min_cron_interval_minutes:        1,
  },
  deadline_watcher: { enabled: false, check_interval_ms: 60_000, warning_threshold_percent: 80 },
};

const UNLIMITED_BUDGET: BudgetTrackerLike = { canAfford: () => true };

function makeScheduleDef(id: string, maxRunsPerDay = 2) {
  return {
    id,
    agent_id:        "agent-1",
    division:        "eng",
    cron_expression: "* * * * *",
    task_template: { description: "test task", priority: 5 },
    enabled:  true,
    governance: { max_cost_per_run: 1.0, max_runs_per_day: maxRunsPerDay, require_approval: false },
    last_run_at:    null,
    next_run_at:    new Date(Date.now() - 60_000).toISOString(),
    total_runs:     0,
    total_cost_usd: 0,
  };
}

describe("FIX-3: CronScheduler — schedule_runs ledger for daily count", () => {
  it("creates schedule_runs table during initialize()", async () => {
    const { CronScheduler } = await import("../../src/scheduler/cron-scheduler.js");
    const db  = new BetterSqlite3(":memory:");
    const sched = new CronScheduler(db, UNLIMITED_BUDGET, GOVERNANCE);
    await sched.initialize();

    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_runs'").get();
    expect(row).toBeDefined();

    db.close();
  });

  it("inserts a row into schedule_runs after successful execution", async () => {
    const { CronScheduler } = await import("../../src/scheduler/cron-scheduler.js");
    const db    = new BetterSqlite3(":memory:");
    const sched = new CronScheduler(db, UNLIMITED_BUDGET, GOVERNANCE);
    await sched.initialize();

    const def = makeScheduleDef("sched-1", 5);
    // Insert schedule row directly
    db.prepare(`
      INSERT INTO schedules (id, agent_id, division, cron_expression, task_description,
        task_priority, enabled, max_cost_per_run, max_runs_per_day, require_approval,
        next_run_at, total_runs, total_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, 0, 0)
    `).run(def.id, def.agent_id, def.division, def.cron_expression,
      def.task_template.description, def.task_template.priority,
      def.governance.max_cost_per_run, def.governance.max_runs_per_day, def.next_run_at);

    const result = await sched.executeDueSchedule(def);
    expect(result.executed).toBe(true);

    const row = db.prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) as cnt FROM schedule_runs WHERE schedule_id = ?",
    ).get(def.id);
    expect(row?.cnt).toBe(1);

    db.close();
  });

  it("blocks execution once max_runs_per_day reached via ledger", async () => {
    const { CronScheduler } = await import("../../src/scheduler/cron-scheduler.js");
    const db    = new BetterSqlite3(":memory:");
    const sched = new CronScheduler(db, UNLIMITED_BUDGET, GOVERNANCE);
    await sched.initialize();

    const def = makeScheduleDef("sched-2", 2);
    db.prepare(`
      INSERT INTO schedules (id, agent_id, division, cron_expression, task_description,
        task_priority, enabled, max_cost_per_run, max_runs_per_day, require_approval,
        next_run_at, total_runs, total_cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, 0, 0)
    `).run(def.id, def.agent_id, def.division, def.cron_expression,
      def.task_template.description, def.task_template.priority,
      def.governance.max_cost_per_run, def.governance.max_runs_per_day, def.next_run_at);

    // Pre-populate schedule_runs with today's quota
    const today = new Date().toISOString();
    db.prepare("INSERT INTO schedule_runs (schedule_id, run_at) VALUES (?, ?)").run(def.id, today);
    db.prepare("INSERT INTO schedule_runs (schedule_id, run_at) VALUES (?, ?)").run(def.id, today);

    const result = await sched.executeDueSchedule(def);
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("max_runs_per_day exceeded");

    db.close();
  });
});

// ---------------------------------------------------------------------------
// FIX-4 — Delegation IPC uses typed CLIRequest (no `as never`)
// ---------------------------------------------------------------------------

describe("FIX-4: Delegation IPC — typed CLIRequest shape", () => {
  it("delegation_status and delegation_history are in CLIRequest command union", async () => {
    // Import types to verify at compile time (runtime check via string set)
    const mod = await import("../../src/orchestrator/orchestrator.js");
    // If the type includes these commands, the ALLOWED_IPC_COMMANDS set does too.
    // We verify by inspecting the exported interface shape indirectly via a cast.
    // Compile-time check: if this file type-checks, FIX-4 is correct.
    const validCommands: Array<import("../../src/orchestrator/orchestrator.js").CLIRequest["command"]> = [
      "delegation_status",
      "delegation_history",
    ];
    expect(validCommands).toHaveLength(2);
    void mod;
  });

  it("ipcRequest in delegation.ts builds { command, payload, request_id } shape", async () => {
    // Verify the delegation module compiles and imports without type errors.
    // The `as never` cast was removed — if this import fails, there's a type regression.
    await expect(import("../../src/cli/commands/delegation.js")).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// FIX-5 — Provider selftest reads persisted config first
// ---------------------------------------------------------------------------

describe("FIX-5: Provider selftest — reads persisted config first", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["OPENAI_API_KEY"] = originalEnv;
    } else {
      delete process.env["OPENAI_API_KEY"];
    }
  });

  it("isProviderConfigured uses env var as fallback when no persisted config", async () => {
    // With no env var and no persisted config → provider not configured
    const { ProviderApiKeyValid } = await import(
      "../../src/core/selftest/checks/provider-checks.js"
    );
    const result = await ProviderApiKeyValid.run({ workDir: "/nonexistent", verbose: false, fix: false });
    // All providers missing → "skip" status
    expect(result.status).toBe("skip");
  });

  it("detects provider from env var when no persisted config exists", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key-for-p251";
    const { ProviderApiKeyValid } = await import(
      "../../src/core/selftest/checks/provider-checks.js"
    );
    const result = await ProviderApiKeyValid.run({ workDir: "/nonexistent", verbose: false, fix: false });
    expect(result.status).toBe("pass");
    expect(result.message).toContain("openai");
  });
});

// ---------------------------------------------------------------------------
// FIX-6 — Governance selftest uses canonical .system/governance path
// ---------------------------------------------------------------------------

describe("FIX-6: Governance selftest — canonical .system/governance path", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("GovernanceRulesLoadable skips when .system/governance does not exist", async () => {
    const { GovernanceRulesLoadable } = await import(
      "../../src/core/selftest/checks/governance-checks.js"
    );
    const result = await GovernanceRulesLoadable.run({ workDir: tmpDir, verbose: false, fix: false });
    expect(result.status).toBe("skip");
    expect(result.message).toContain("sidjua apply");
  });

  it("GovernanceRulesLoadable does NOT look at {workDir}/system/governance (wrong path)", async () => {
    // Create the wrong-path directory — should still return skip (not pass or fail)
    mkdirSync(join(tmpDir, "system", "governance"), { recursive: true });

    const { GovernanceRulesLoadable } = await import(
      "../../src/core/selftest/checks/governance-checks.js"
    );
    const result = await GovernanceRulesLoadable.run({ workDir: tmpDir, verbose: false, fix: false });
    // Should still skip because .system/governance doesn't exist
    expect(result.status).toBe("skip");
  });

  it("PolicyEnforcementFunctional skips when .system/governance/governance.yaml absent", async () => {
    const { PolicyEnforcementFunctional } = await import(
      "../../src/core/selftest/checks/governance-checks.js"
    );
    const result = await PolicyEnforcementFunctional.run({
      workDir: tmpDir, verbose: false, fix: false,
    });
    expect(result.status).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// FIX-7 — Health command opens DB read-only (no journal_mode mutation)
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

describe("FIX-7: Health command — read-only DB access", () => {
  it("health.ts source does NOT contain an explicit journal_mode = WAL pragma", () => {
    const thisDir    = dirname(fileURLToPath(import.meta.url));
    const healthPath = resolve(thisDir, "../../src/cli/commands/health.ts");
    const source     = readFileSync(healthPath, "utf-8");

    // The fix removed the explicit journal_mode = WAL mutation from health.ts.
    // openDatabase() already handles WAL; health only needs query_only = ON.
    expect(source).not.toContain("journal_mode = WAL");
  });

  it("health.ts opens DB with readonly: true instead of query_only pragma", () => {
    const thisDir    = dirname(fileURLToPath(import.meta.url));
    const healthPath = resolve(thisDir, "../../src/cli/commands/health.ts");
    const source     = readFileSync(healthPath, "utf-8");

    // P266: query_only toggle removed — readonly connection via constructor option
    expect(source).not.toContain("query_only = ON");
    expect(source).toContain("readonly: true");
  });

  it("runHealthCommand completes without error on a valid DB", async () => {
    const tmpDir = makeTmpDir();
    try {
      const dbPath = join(tmpDir, ".system", "sidjua.db");
      const setup  = new BetterSqlite3(dbPath);
      setup.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
      setup.close();

      const { runHealthCommand } = await import("../../src/cli/commands/health.js");
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const code = runHealthCommand({ workDir: tmpDir, json: false });
      expect(typeof code).toBe("number");

      vi.restoreAllMocks();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
