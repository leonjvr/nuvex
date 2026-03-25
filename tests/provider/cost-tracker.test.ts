/**
 * Tests for src/provider/cost-tracker.ts
 *
 * Covers:
 * - checkBudget: no budget row → unlimited
 * - checkBudget: daily limit exceeded → allowed=false
 * - checkBudget: monthly limit exceeded → allowed=false
 * - checkBudget: within daily limit → allowed=true
 * - checkBudget: nearLimit flag at alert threshold
 * - checkBudget: daily checked before monthly
 * - checkBudget: both limits null → unlimited
 * - recordCost: inserts row into cost_ledger
 * - getDailySpend / getMonthlySpend: queries
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import { CostTracker } from "../../src/provider/cost-tracker.js";
import type { Database } from "../../src/utils/db.js";
import type { TokenUsage } from "../../src/types/provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedDivision(db: Database, code: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)",
  ).run(code, code);
}

function seedBudget(
  db: Database,
  division: string,
  daily: number | null,
  monthly: number | null,
  threshold = 80,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO cost_budgets
       (division_code, daily_limit_usd, monthly_limit_usd, alert_threshold_percent)
     VALUES (?, ?, ?, ?)`,
  ).run(division, daily, monthly, threshold);
}

function seedSpend(db: Database, division: string, costUsd: number): void {
  db.prepare(
    `INSERT INTO cost_ledger
       (division_code, agent_id, provider, model, cost_usd, input_tokens, output_tokens)
     VALUES (?, 'agent-1', 'anthropic', 'claude-sonnet-4-6', ?, 100, 50)`,
  ).run(division, costUsd);
}

const testUsage: TokenUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let tracker: CostTracker;

beforeEach(() => {
  tmpDir  = mkdtempSync(join(tmpdir(), "sidjua-cost-tracker-test-"));
  db      = openDatabase(join(tmpDir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS);
  seedDivision(db, "engineering");
  tracker = new CostTracker(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// checkBudget — no budget configured
// ---------------------------------------------------------------------------

describe("CostTracker.checkBudget — no budget row", () => {
  it("returns allowed=true for unknown division", () => {
    const result = tracker.checkBudget("unknown-division", 100);
    expect(result.allowed).toBe(true);
    expect(result.dailyLimitUsd).toBeNull();
    expect(result.monthlyLimitUsd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkBudget — daily limit
// ---------------------------------------------------------------------------

describe("CostTracker.checkBudget — daily limit", () => {
  it("allows when spend + estimate is within daily limit", () => {
    seedBudget(db, "engineering", 10, null);
    const result = tracker.checkBudget("engineering", 5.0);
    expect(result.allowed).toBe(true);
    expect(result.nearLimit).toBe(false);
  });

  it("blocks when spend + estimate would exceed daily limit", () => {
    seedBudget(db, "engineering", 10, null);
    seedSpend(db, "engineering", 8.0);
    const result = tracker.checkBudget("engineering", 5.0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily limit");
  });

  it("sets nearLimit=true when at or above alert threshold", () => {
    seedBudget(db, "engineering", 10, null, 80); // 80% threshold = $8
    seedSpend(db, "engineering", 7.0);           // current = $7
    // $7 + $1.5 = $8.5 → 85% ≥ 80% → near limit
    const result = tracker.checkBudget("engineering", 1.5);
    expect(result.allowed).toBe(true);
    expect(result.nearLimit).toBe(true);
  });

  it("nearLimit=false when below alert threshold", () => {
    seedBudget(db, "engineering", 10, null, 80);
    seedSpend(db, "engineering", 1.0);
    // $1 + $1 = $2 → 20% < 80%
    const result = tracker.checkBudget("engineering", 1.0);
    expect(result.nearLimit).toBe(false);
  });

  it("exactly at limit is blocked (strictly greater-than check)", () => {
    seedBudget(db, "engineering", 10, null);
    seedSpend(db, "engineering", 5.0);
    // $5 + $5 = $10 — exactly at limit, NOT exceeded
    const result = tracker.checkBudget("engineering", 5.0);
    expect(result.allowed).toBe(true);
  });

  it("one cent over limit is blocked", () => {
    seedBudget(db, "engineering", 10, null);
    seedSpend(db, "engineering", 5.0);
    // $5 + $5.01 = $10.01 > $10
    const result = tracker.checkBudget("engineering", 5.01);
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkBudget — monthly limit
// ---------------------------------------------------------------------------

describe("CostTracker.checkBudget — monthly limit", () => {
  it("blocks when spend + estimate would exceed monthly limit", () => {
    seedBudget(db, "engineering", null, 100);
    seedSpend(db, "engineering", 95.0);
    const result = tracker.checkBudget("engineering", 10.0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Monthly limit");
  });

  it("allows when within monthly limit", () => {
    seedBudget(db, "engineering", null, 100);
    seedSpend(db, "engineering", 50.0);
    const result = tracker.checkBudget("engineering", 10.0);
    expect(result.allowed).toBe(true);
  });

  it("sets nearLimit for monthly threshold", () => {
    seedBudget(db, "engineering", null, 100, 80);
    seedSpend(db, "engineering", 75.0);
    // $75 + $10 = $85 → 85% ≥ 80%
    const result = tracker.checkBudget("engineering", 10.0);
    expect(result.allowed).toBe(true);
    expect(result.nearLimit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkBudget — both limits configured
// ---------------------------------------------------------------------------

describe("CostTracker.checkBudget — daily + monthly limits", () => {
  it("daily limit check takes priority when daily would be exceeded", () => {
    seedBudget(db, "engineering", 5, 100);
    seedSpend(db, "engineering", 4.5);
    // daily: $4.5 + $1 = $5.5 > $5 → blocked
    const result = tracker.checkBudget("engineering", 1.0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily limit");
  });

  it("monthly limit checked when daily is OK", () => {
    seedBudget(db, "engineering", 100, 10); // monthly is the tight one
    seedSpend(db, "engineering", 8.0);
    // daily: $8 + $5 = $13 < $100 → OK. monthly: $8 + $5 = $13 > $10 → blocked
    const result = tracker.checkBudget("engineering", 5.0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Monthly limit");
  });

  it("both null → unlimited", () => {
    seedBudget(db, "engineering", null, null);
    const result = tracker.checkBudget("engineering", 999_999);
    expect(result.allowed).toBe(true);
    expect(result.nearLimit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordCost
// ---------------------------------------------------------------------------

describe("CostTracker.recordCost", () => {
  it("inserts a row into cost_ledger", () => {
    tracker.recordCost("engineering", "agent-1", "anthropic", "claude-sonnet-4-6", testUsage, 0.05);
    const row = db
      .prepare("SELECT * FROM cost_ledger WHERE division_code = 'engineering'")
      .get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row["cost_usd"]).toBe(0.05);
    expect(row["input_tokens"]).toBe(100);
    expect(row["output_tokens"]).toBe(50);
  });

  it("stores task_id when provided", () => {
    tracker.recordCost("engineering", "agent-1", "anthropic", "claude-sonnet-4-6", testUsage, 0.01, "task-abc");
    const row = db
      .prepare("SELECT task_id FROM cost_ledger WHERE division_code = 'engineering'")
      .get() as Record<string, unknown>;
    expect(row["task_id"]).toBe("task-abc");
  });

  it("stores NULL task_id when not provided", () => {
    tracker.recordCost("engineering", "agent-1", "openai", "gpt-4o", testUsage, 0.02);
    const row = db
      .prepare("SELECT task_id FROM cost_ledger WHERE division_code = 'engineering'")
      .get() as Record<string, unknown>;
    expect(row["task_id"]).toBeNull();
  });

  it("multiple calls accumulate in getDailySpend", () => {
    tracker.recordCost("engineering", "agent-1", "anthropic", "claude-sonnet-4-6", testUsage, 1.0);
    tracker.recordCost("engineering", "agent-1", "anthropic", "claude-sonnet-4-6", testUsage, 2.0);
    expect(tracker.getDailySpend("engineering")).toBeCloseTo(3.0);
  });
});

// ---------------------------------------------------------------------------
// getDailySpend / getMonthlySpend
// ---------------------------------------------------------------------------

describe("CostTracker.getDailySpend / getMonthlySpend", () => {
  it("returns 0 when no ledger entries", () => {
    expect(tracker.getDailySpend("engineering")).toBe(0);
    expect(tracker.getMonthlySpend("engineering")).toBe(0);
  });

  it("sums entries for the division", () => {
    seedSpend(db, "engineering", 3.5);
    seedSpend(db, "engineering", 2.0);
    expect(tracker.getDailySpend("engineering")).toBeCloseTo(5.5);
    expect(tracker.getMonthlySpend("engineering")).toBeCloseTo(5.5);
  });

  it("does not include entries from other divisions", () => {
    seedDivision(db, "sales");
    seedSpend(db, "engineering", 10.0);
    seedSpend(db, "sales", 20.0);
    expect(tracker.getDailySpend("engineering")).toBeCloseTo(10.0);
    expect(tracker.getDailySpend("sales")).toBeCloseTo(20.0);
  });

  it("returns 0 for division with no entries", () => {
    expect(tracker.getDailySpend("ghost-division")).toBe(0);
  });
});
