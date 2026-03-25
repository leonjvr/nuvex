/**
 * Phase 10.5 — Integration: Budget cascade enforcement
 *
 * Tests the full org → division → agent → task cascade.
 * All levels checked. Lowest limit wins.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { BudgetResolver } from "../../../src/agent-lifecycle/budget-resolver.js";
import { AgentRegistry } from "../../../src/agent-lifecycle/agent-registry.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import type { AgentLifecycleDefinition } from "../../../src/agent-lifecycle/types.js";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at TEXT);
    CREATE TABLE IF NOT EXISTS divisions (code TEXT PRIMARY KEY, name_en TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      division_code TEXT, agent_id TEXT, provider TEXT, model TEXT,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0, task_id TEXT
    );
    CREATE TABLE IF NOT EXISTS cost_budgets (
      division_code TEXT PRIMARY KEY, monthly_limit_usd REAL, daily_limit_usd REAL,
      alert_threshold_percent REAL DEFAULT 80.0
    );
  `);
  runMigrations105(db);
  return db;
}

const AGENT: AgentLifecycleDefinition = {
  id: "haiku-coder",
  name: "Haiku Coder",
  tier: 3,
  division: "engineering",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  skill: "test.md",
  capabilities: ["coding"],
  budget: { per_task_usd: 2.00, per_month_usd: 50.00, per_hour_usd: 5.00 },
};

describe("Integration: Budget Cascade Enforcement", () => {
  let db: ReturnType<typeof makeDb>;
  let resolver: BudgetResolver;
  let registry: AgentRegistry;

  beforeEach(() => {
    db = makeDb();
    resolver = new BudgetResolver(db);
    registry = new AgentRegistry(db);
  });

  it("allows when all levels pass (no limits)", () => {
    registry.create(AGENT);
    const result = resolver.resolve("haiku-coder", "engineering", 0.50);
    expect(result.allowed).toBe(true);
    expect(result.details).toHaveLength(4);
  });

  it("blocks at org level (monthly limit)", () => {
    registry.create(AGENT);
    db.prepare("INSERT INTO cost_budgets (division_code, monthly_limit_usd) VALUES (?, ?)").run("engineering", 10.00);
    db.prepare("INSERT INTO cost_ledger (division_code, agent_id, provider, model, cost_usd) VALUES (?, ?, ?, ?, ?)").run("engineering", "haiku-coder", "anthropic", "haiku", 9.90);

    const result = resolver.resolve("haiku-coder", "engineering", 0.50);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("org");
  });

  it("blocks at division level", () => {
    registry.create(AGENT);
    // spent=$99 of $100 limit; estimate=$1.50 passes per_task ($1.50 ≤ $2) but $99+$1.50>$100
    db.prepare("INSERT INTO division_budgets (division, period_start, period_type, spent_usd, limit_usd) VALUES (?, strftime('%Y-%m-01','now'), 'monthly', ?, ?)").run("engineering", 99.00, 100.00);

    const result = resolver.resolve("haiku-coder", "engineering", 1.50);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("division");
  });

  it("blocks at agent level", () => {
    registry.create(AGENT);
    db.prepare("INSERT INTO agent_budgets (agent_id, period_start, period_type, spent_usd, limit_usd) VALUES (?, strftime('%Y-%m-01','now'), 'monthly', ?, ?)").run("haiku-coder", 49.00, 50.00);

    const result = resolver.resolve("haiku-coder", "engineering", 2.00);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("agent");
  });

  it("blocks at task level (per_task_usd)", () => {
    registry.create(AGENT);
    const result = resolver.resolve("haiku-coder", "engineering", 3.00); // > $2 per task
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("task");
  });

  it("org OK but agent blocks: agent wins", () => {
    registry.create(AGENT);
    db.prepare("INSERT INTO cost_budgets (division_code, monthly_limit_usd) VALUES (?, ?)").run("engineering", 1000.00);
    db.prepare("INSERT INTO agent_budgets (agent_id, period_start, period_type, spent_usd, limit_usd) VALUES (?, strftime('%Y-%m-01','now'), 'monthly', ?, ?)").run("haiku-coder", 49.00, 50.00);

    const result = resolver.resolve("haiku-coder", "engineering", 2.00);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("agent");
  });

  it("3 agents in division, shared budget distributed correctly", () => {
    const agents = [
      { ...AGENT, id: "worker-1", budget: { per_task_usd: 2.00, per_month_usd: 20.00, per_hour_usd: 5.00 } },
      { ...AGENT, id: "worker-2", budget: { per_task_usd: 2.00, per_month_usd: 20.00, per_hour_usd: 5.00 } },
      { ...AGENT, id: "worker-3", budget: { per_task_usd: 2.00, per_month_usd: 20.00, per_hour_usd: 5.00 } },
    ];
    for (const a of agents) registry.create(a);

    db.prepare("INSERT INTO cost_budgets (division_code, monthly_limit_usd) VALUES (?, ?)").run("engineering", 30.00);
    // Each agent spent $10 (org total: $30)
    for (const a of agents) {
      db.prepare("INSERT INTO cost_ledger (division_code, agent_id, provider, model, cost_usd) VALUES (?, ?, ?, ?, ?)").run("engineering", a.id, "anthropic", "haiku", 10.00);
    }

    // Any additional spend would exceed org limit
    const result = resolver.resolve("worker-1", "engineering", 0.01);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("org");
  });
});
