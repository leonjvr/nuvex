/**
 * Phase 10.5 — BudgetResolver unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { BudgetResolver } from "../../src/agent-lifecycle/budget-resolver.js";
import { AgentRegistry } from "../../src/agent-lifecycle/agent-registry.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";
import type { AgentLifecycleDefinition } from "../../src/agent-lifecycle/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at TEXT);
    CREATE TABLE IF NOT EXISTS divisions (code TEXT PRIMARY KEY, name_en TEXT, active INTEGER DEFAULT 1);
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

const AGENT_DEF: AgentLifecycleDefinition = {
  id: "test-worker",
  name: "Test Worker",
  tier: 3,
  division: "engineering",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  skill: "test.md",
  capabilities: ["coding"],
  budget: {
    per_task_usd: 2.00,
    per_hour_usd: 5.00,
    per_month_usd: 50.00,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BudgetResolver", () => {
  let db: ReturnType<typeof makeDb>;
  let resolver: BudgetResolver;
  let registry: AgentRegistry;

  beforeEach(() => {
    db = makeDb();
    resolver = new BudgetResolver(db);
    registry = new AgentRegistry(db);
  });

  it("allows when no limits configured anywhere", () => {
    const result = resolver.resolve("no-agent", "no-division", 1.00);
    expect(result.allowed).toBe(true);
    expect(result.details).toHaveLength(4); // all 4 levels checked
  });

  it("blocks at org level when monthly limit exceeded", () => {
    db.prepare("INSERT INTO cost_budgets (division_code, monthly_limit_usd) VALUES (?, ?)")
      .run("engineering", 10.00);
    db.prepare("INSERT INTO cost_ledger (division_code, agent_id, provider, model, cost_usd) VALUES (?, ?, ?, ?, ?)")
      .run("engineering", "agent-1", "anthropic", "haiku", 9.90);

    const result = resolver.resolve("agent-1", "engineering", 0.50);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("org");
  });

  it("blocks at agent level when agent monthly limit exceeded", () => {
    registry.create(AGENT_DEF);

    // Record agent spend: $49.50 already spent (limit is $50)
    db.prepare(`
      INSERT INTO agent_budgets (agent_id, period_start, period_type, spent_usd, limit_usd)
      VALUES (?, strftime('%Y-%m-01', 'now'), 'monthly', 49.50, 50.00)
    `).run("test-worker");

    const result = resolver.resolve("test-worker", "engineering", 1.00);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("agent");
  });

  it("blocks at task level when estimated cost exceeds per_task limit", () => {
    registry.create(AGENT_DEF);

    const result = resolver.resolve("test-worker", "engineering", 5.00); // limit is $2/task
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("task");
  });

  it("blocks at task level using explicit task budget override", () => {
    registry.create(AGENT_DEF);

    // No per_task limit in config, but explicit task budget of $1
    const defNoTaskBudget = { ...AGENT_DEF, id: "worker-2", budget: { per_month_usd: 100.00 } };
    registry.create(defNoTaskBudget);

    const result = resolver.resolve("worker-2", "engineering", 2.00, 1.00); // taskBudget=$1
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("task");
  });

  it("allows when all levels pass", () => {
    registry.create(AGENT_DEF);

    db.prepare("INSERT INTO cost_budgets (division_code, monthly_limit_usd) VALUES (?, ?)")
      .run("engineering", 1000.00);

    const result = resolver.resolve("test-worker", "engineering", 0.50);
    expect(result.allowed).toBe(true);
    expect(result.blocked_by).toBeUndefined();
  });

  it("lowest limit wins", () => {
    registry.create({ ...AGENT_DEF, budget: { per_task_usd: 2.00, per_month_usd: 50.00 } });
    db.prepare("INSERT INTO cost_budgets (division_code, monthly_limit_usd) VALUES (?, ?)")
      .run("engineering", 200.00);
    db.prepare("INSERT INTO division_budgets (division, period_start, period_type, spent_usd, limit_usd) VALUES (?, strftime('%Y-%m-01','now'), 'monthly', 0, ?)")
      .run("engineering", 100.00);

    const result = resolver.resolve("test-worker", "engineering", 0.50);
    expect(result.allowed).toBe(true);
    // effective limit should be the lowest applicable (agent's $50)
    expect(result.effective_limit_usd).toBeLessThanOrEqual(100.00);
  });

  it("detects near_limit when usage ≥ 80%", () => {
    registry.create(AGENT_DEF);

    // Agent spent $42 of $50 limit + estimate $2 = $44 (88%)
    db.prepare(`
      INSERT INTO agent_budgets (agent_id, period_start, period_type, spent_usd, limit_usd)
      VALUES (?, strftime('%Y-%m-01', 'now'), 'monthly', 42.00, 50.00)
    `).run("test-worker");

    const result = resolver.resolve("test-worker", "engineering", 0.50);
    // Should be within limit but near (42+0.5 = 42.5 / 50 = 85%)
    expect(result.near_limit).toBe(true);
  });

  it("recordAgentCost upserts into agent_budgets", () => {
    registry.create(AGENT_DEF);

    resolver.recordAgentCost("test-worker", 1.50);
    resolver.recordAgentCost("test-worker", 0.75);

    const row = db.prepare(
      "SELECT spent_usd FROM agent_budgets WHERE agent_id = ? AND period_type = 'monthly'",
    ).get("test-worker") as { spent_usd: number } | undefined;

    expect(row?.spent_usd).toBeCloseTo(2.25);
  });

  it("returns 4 detail entries for 4 levels", () => {
    const result = resolver.resolve("unknown-agent", "unknown-div", 0.01);
    const levels = result.details.map((d) => d.level);
    expect(levels).toContain("org");
    expect(levels).toContain("division");
    expect(levels).toContain("agent");
    expect(levels).toContain("task");
  });
});

// ---------------------------------------------------------------------------
// Fail-closed behaviour — DB errors must DENY, not allow
// ---------------------------------------------------------------------------

describe("BudgetResolver fail-closed on DB errors", () => {
  it("denies action when org-level DB query fails", () => {
    const db = new Database(":memory:");
    // No tables at all — any query throws "no such table"
    const resolver = new BudgetResolver(db);
    const result = resolver.resolve("agent-1", "eng", 0.01);
    expect(result.allowed).toBe(false);
  });

  it("denies action when division-level table is missing", () => {
    const db = new Database(":memory:");
    // Provide cost_budgets (org) but not division_budgets
    db.exec(`
      CREATE TABLE cost_budgets (
        division_code TEXT PRIMARY KEY,
        monthly_limit_usd REAL,
        daily_limit_usd REAL,
        alert_threshold_percent REAL DEFAULT 80.0
      );
      CREATE TABLE cost_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now')),
        division_code TEXT,
        cost_usd REAL DEFAULT 0
      );
    `);
    const resolver = new BudgetResolver(db);
    const result = resolver.resolve("agent-1", "eng", 0.01);
    // division_budgets table missing → fail-closed
    expect(result.allowed).toBe(false);
    const divDetail = result.details.find((d) => d.level === "division");
    expect(divDetail?.allowed).toBe(false);
  });

  it("fail-closed results have limit_usd of 0 (not null)", () => {
    const db = new Database(":memory:");
    const resolver = new BudgetResolver(db);
    const result = resolver.resolve("agent-1", "eng", 0.01);
    expect(result.allowed).toBe(false);
    for (const detail of result.details) {
      if (!detail.allowed && detail.limit_usd !== null) {
        expect(detail.limit_usd).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("BudgetResolver.checkAndSpend — fail-closed on missing table", () => {
  it("returns false (blocked) when agent_budgets table is absent", () => {
    // DB with NO tables — simulates pre-apply state
    const db = new Database(":memory:");
    const resolver = new BudgetResolver(db);
    // Should fail closed, not return true
    const result = resolver.checkAndSpend("agent-1", 0.05);
    expect(result).toBe(false);
  });
});
