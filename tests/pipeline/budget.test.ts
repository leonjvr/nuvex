/**
 * Tests for src/pipeline/budget.ts — Stage 3
 *
 * Checklist items covered:
 *   ✓ Budget PAUSE when daily limit exceeded
 *   ✓ Budget WARN at threshold percent
 *   ✓ Budget passes when no limit configured
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import { checkBudget, getBudget, getDailySpend, getMonthlySpend } from "../../src/pipeline/budget.js";
import type { ActionRequest } from "../../src/types/pipeline.js";
import type { Database } from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(estimatedCostUsd?: number, divisionCode = "engineering"): ActionRequest {
  return {
    request_id:    "req-001",
    timestamp:     "2026-02-27T00:00:00Z",
    agent_id:      "agent-1",
    agent_tier:    2,
    division_code: divisionCode,
    action: {
      type:               "api.call",
      target:             "https://api.example.com",
      description:        "test",
      estimated_cost_usd: estimatedCostUsd,
    },
    context: { division_code: divisionCode, session_id: "sess-001" },
  };
}

function seedBudget(db: Database, division: string, daily: number | null, monthly: number | null, threshold = 80): void {
  db.prepare(
    `INSERT OR REPLACE INTO cost_budgets (division_code, daily_limit_usd, monthly_limit_usd, alert_threshold_percent)
     VALUES (?, ?, ?, ?)`
  ).run(division, daily, monthly, threshold);
}

function seedSpend(db: Database, division: string, costUsd: number): void {
  db.prepare(
    `INSERT INTO cost_ledger (division_code, agent_id, provider, model, cost_usd, input_tokens, output_tokens)
     VALUES (?, 'agent-1', 'anthropic', 'claude', ?, 100, 100)`
  ).run(division, costUsd);
}

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-budget-test-"));
  db     = openDatabase(join(tmpDir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS);
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)").run("engineering", "Engineering");
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkBudget — Stage 3", () => {
  it("PASS: no cost estimate provided", () => {
    seedBudget(db, "engineering", 10, 100);
    const result = checkBudget(makeRequest(undefined), db);
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked[0]?.rule_id).toBe("budget.no_estimate");
  });

  it("PASS: zero cost estimate", () => {
    seedBudget(db, "engineering", 10, 100);
    const result = checkBudget(makeRequest(0), db);
    expect(result.verdict).toBe("PASS");
  });

  it("PASS: no budget configured for division", () => {
    // No row in cost_budgets for this division
    const result = checkBudget(makeRequest(5.0, "finance"), db);
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked[0]?.rule_id).toBe("budget.no_limit");
  });

  it("PASS: cost within daily limit", () => {
    seedBudget(db, "engineering", 10, null);
    const result = checkBudget(makeRequest(5.0), db);
    expect(result.verdict).toBe("PASS");
  });

  it("PAUSE: estimated cost would exceed daily limit", () => {
    seedBudget(db, "engineering", 10, null);
    seedSpend(db, "engineering", 8.0);
    const result = checkBudget(makeRequest(5.0), db);
    expect(result.verdict).toBe("PAUSE");
    const check = result.rules_checked.find((c) => c.matched);
    expect(check?.rule_id).toBe("budget.daily_exceeded");
  });

  it("WARN: cost at alert threshold for daily", () => {
    seedBudget(db, "engineering", 10, null, 80);
    seedSpend(db, "engineering", 7.0);
    // 7 + 1.5 = 8.5 / 10 = 85% >= 80% → WARN
    const result = checkBudget(makeRequest(1.5), db);
    expect(result.verdict).toBe("WARN");
    const warnCheck = result.rules_checked.find((c) => c.verdict === "WARN");
    expect(warnCheck?.rule_id).toBe("budget.daily_warn");
  });

  it("PAUSE: estimated cost would exceed monthly limit", () => {
    seedBudget(db, "engineering", null, 100);
    seedSpend(db, "engineering", 95.0);
    const result = checkBudget(makeRequest(10.0), db);
    expect(result.verdict).toBe("PAUSE");
    const check = result.rules_checked.find((c) => c.matched && c.rule_id === "budget.monthly_exceeded");
    expect(check).toBeDefined();
  });

  it("WARN: cost at alert threshold for monthly", () => {
    seedBudget(db, "engineering", null, 100, 80);
    seedSpend(db, "engineering", 75.0);
    // 75 + 10 = 85 / 100 = 85% >= 80%
    const result = checkBudget(makeRequest(10.0), db);
    expect(result.verdict).toBe("WARN");
  });

  it("daily limit check takes priority over monthly limit check", () => {
    seedBudget(db, "engineering", 5, 100, 80);
    seedSpend(db, "engineering", 4.5);
    // daily: 4.5 + 1 = 5.5 > 5 → PAUSE
    const result = checkBudget(makeRequest(1.0), db);
    expect(result.verdict).toBe("PAUSE");
    const check = result.rules_checked.find((c) => c.matched);
    expect(check?.rule_id).toBe("budget.daily_exceeded");
  });
});

describe("getDailySpend / getMonthlySpend", () => {
  it("returns 0 when no entries exist", () => {
    expect(getDailySpend(db, "engineering")).toBe(0);
    expect(getMonthlySpend(db, "engineering")).toBe(0);
  });

  it("sums entries for the division", () => {
    seedSpend(db, "engineering", 3.5);
    seedSpend(db, "engineering", 2.0);
    expect(getDailySpend(db, "engineering")).toBeCloseTo(5.5);
    expect(getMonthlySpend(db, "engineering")).toBeCloseTo(5.5);
  });

  it("does not include entries from other divisions", () => {
    seedSpend(db, "engineering", 10.0);
    db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)").run("finance", "Finance");
    seedSpend(db, "finance", 20.0);
    expect(getDailySpend(db, "engineering")).toBeCloseTo(10.0);
  });
});

describe("getBudget", () => {
  it("returns null when no budget configured", () => {
    expect(getBudget(db, "unknown-division")).toBeNull();
  });

  it("returns budget row", () => {
    seedBudget(db, "engineering", 10, 100, 75);
    const budget = getBudget(db, "engineering");
    expect(budget).not.toBeNull();
    expect(budget?.daily_limit_usd).toBe(10);
    expect(budget?.monthly_limit_usd).toBe(100);
    expect(budget?.alert_threshold_percent).toBe(75);
  });
});
