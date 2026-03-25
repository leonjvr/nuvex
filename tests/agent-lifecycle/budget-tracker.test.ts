/**
 * Phase 10.5 — BudgetTracker unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { BudgetTracker } from "../../src/agent-lifecycle/budget-tracker.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at TEXT);
    CREATE TABLE IF NOT EXISTS cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      division_code TEXT,
      agent_id TEXT,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      task_id TEXT
    );
    CREATE TABLE IF NOT EXISTS cost_budgets (
      division_code TEXT PRIMARY KEY,
      monthly_limit_usd REAL,
      daily_limit_usd REAL,
      alert_threshold_percent REAL DEFAULT 80.0
    );
  `);
  runMigrations105(db);
  return db;
}

function insertCost(
  db: Database.Database,
  agentId: string,
  division: string,
  cost: number,
  daysAgo = 0,
) {
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO cost_ledger (timestamp, division_code, agent_id, provider, model, cost_usd)
    VALUES (?, ?, ?, 'anthropic', 'haiku', ?)
  `).run(ts, division, agentId, cost);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BudgetTracker", () => {
  let db: ReturnType<typeof makeDb>;
  let tracker: BudgetTracker;

  beforeEach(() => {
    db = makeDb();
    tracker = new BudgetTracker(db);
  });

  it("getAgentMonthlySpend returns 0 with no records", () => {
    expect(tracker.getAgentMonthlySpend("ghost")).toBe(0);
  });

  it("getAgentMonthlySpend sums this month's costs", () => {
    insertCost(db, "agent-1", "eng", 1.50);
    insertCost(db, "agent-1", "eng", 0.75);
    expect(tracker.getAgentMonthlySpend("agent-1")).toBeCloseTo(2.25);
  });

  it("getAgentDailySpend returns today's costs only", () => {
    insertCost(db, "agent-1", "eng", 5.00);
    insertCost(db, "agent-1", "eng", 10.00, 2); // 2 days ago
    expect(tracker.getAgentDailySpend("agent-1")).toBeCloseTo(5.00);
  });

  it("getOrgMonthlySpend sums all divisions", () => {
    insertCost(db, "a1", "eng", 10.00);
    insertCost(db, "a2", "content", 5.00);
    expect(tracker.getOrgMonthlySpend()).toBeCloseTo(15.00);
  });

  it("getDivisionMonthlySpend delegates to CostTracker", () => {
    insertCost(db, "a1", "eng", 3.50);
    insertCost(db, "a2", "content", 1.50);
    expect(tracker.getDivisionMonthlySpend("eng")).toBeCloseTo(3.50);
    expect(tracker.getDivisionMonthlySpend("content")).toBeCloseTo(1.50);
  });

  it("checkAgentBudgetAlert returns null when under threshold", () => {
    insertCost(db, "agent-1", "eng", 30.00);
    const alert = tracker.checkAgentBudgetAlert("agent-1", 100.00);
    expect(alert).toBeNull();
  });

  it("checkAgentBudgetAlert returns warning at ≥80%", () => {
    insertCost(db, "agent-1", "eng", 82.00);
    const alert = tracker.checkAgentBudgetAlert("agent-1", 100.00);
    expect(alert).not.toBeNull();
    expect(alert?.level).toBe("warning");
    expect(alert?.scope).toBe("agent");
    expect(alert?.scope_id).toBe("agent-1");
  });

  it("checkAgentBudgetAlert returns critical at ≥95%", () => {
    insertCost(db, "agent-1", "eng", 96.00);
    const alert = tracker.checkAgentBudgetAlert("agent-1", 100.00);
    expect(alert?.level).toBe("critical");
  });

  it("checkAgentBudgetAlert returns exceeded at ≥100%", () => {
    insertCost(db, "agent-1", "eng", 101.00);
    const alert = tracker.checkAgentBudgetAlert("agent-1", 100.00);
    expect(alert?.level).toBe("exceeded");
  });

  it("checkDivisionBudgetAlert returns warning at ≥80%", () => {
    insertCost(db, "a1", "eng", 85.00);
    const alert = tracker.checkDivisionBudgetAlert("eng", 100.00);
    expect(alert?.level).toBe("warning");
    expect(alert?.scope).toBe("division");
  });

  it("checkAlerts returns empty array when no agents/divisions configured", () => {
    insertCost(db, "a1", "eng", 5.00);
    const alerts = tracker.checkAlerts();
    expect(Array.isArray(alerts)).toBe(true);
    // No agent_definitions or division_budgets rows → no alerts
    expect(alerts).toHaveLength(0);
  });

  it("checkAlerts detects division budget alerts", () => {
    insertCost(db, "a1", "eng", 88.00);
    db.prepare("INSERT INTO division_budgets (division, period_start, period_type, spent_usd, limit_usd) VALUES (?, strftime('%Y-%m-01','now'), 'monthly', 0, 100.00)")
      .run("eng");

    const alerts = tracker.checkAlerts();
    const divAlert = alerts.find((a) => a.scope === "division" && a.scope_id === "eng");
    expect(divAlert).toBeDefined();
    expect(divAlert?.level).toBe("warning");
  });

  it("costTracker property wraps Phase 6 CostTracker", () => {
    expect(tracker.costTracker).toBeDefined();
    expect(typeof tracker.costTracker.checkBudget).toBe("function");
    expect(typeof tracker.costTracker.recordCost).toBe("function");
  });
});
