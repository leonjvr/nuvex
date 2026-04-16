// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Stage 3: Budget Check
 *
 * Compares the action's estimated cost against per-division budget limits
 * stored in the cost_budgets and cost_ledger DB tables.
 *
 * Verdicts:
 *   PASS  — cost OK, or no estimate, or no budget configured
 *   WARN  — projected spend is at or above the alert threshold
 *   PAUSE — projected spend would exceed the daily or monthly limit
 *
 * Note: limits come from the cost_budgets DB table provisioned by
 * `sidjua apply`. The spending-limits.yaml is not read at runtime.
 */

import type { ActionRequest, StageResult } from "../types/pipeline.js";
import type { Database } from "../utils/db.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("budget");
const BUDGET_SOURCE = "db:cost_budgets";


interface BudgetRow {
  division_code:           string;
  monthly_limit_usd:       number | null;
  daily_limit_usd:         number | null;
  alert_threshold_percent: number;
}

interface SpendRow {
  total: number;
}


/**
 * Stage 3: Check whether the action would exceed configured budget limits.
 *
 * Uses an SQLite transaction to atomically check spend (including
 * pending_reservations) and insert a reservation if the check passes.
 * This eliminates the TOCTOU race where two concurrent actions could both
 * pass the budget check before either commits its cost to cost_ledger.
 *
 * @param request  The incoming action request
 * @param db       Open database handle (reads cost_budgets + cost_ledger)
 * @returns        StageResult with PASS, WARN, or PAUSE verdict
 */
export function checkBudget(
  request: ActionRequest,
  db: Database,
): StageResult {
  const start = Date.now();
  const checks = [];

  // Reject negative cost estimates (sign error or crafted request)
  const cost = request.action.estimated_cost_usd;
  if (cost !== undefined && cost < 0) {
    checks.push({
      rule_id:     "budget.negative_cost",
      rule_source: "system",
      matched:     true,
      verdict:     "BLOCK" as const,
      reason:      `Negative cost estimate rejected: $${cost.toFixed(4)}`,
    });
    return {
      stage:         "budget",
      verdict:       "PAUSE",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  // No cost estimate — cannot check
  if (cost === undefined || cost === 0) {
    checks.push({
      rule_id:     "budget.no_estimate",
      rule_source: "system",
      matched:     false,
      verdict:     "PASS" as const,
      reason:      "No cost estimate provided",
    });
    return {
      stage:         "budget",
      verdict:       "PASS",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  const division = request.context.division_code;

  // Load budget limits from DB
  const budget = getBudget(db, division);
  if (budget === null) {
    checks.push({
      rule_id:     "budget.no_limit",
      rule_source: BUDGET_SOURCE,
      matched:     false,
      verdict:     "PASS" as const,
      reason:      "No budget configured for division",
    });
    return {
      stage:         "budget",
      verdict:       "PASS",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  // Atomically check spend (including pending reservations) + insert reservation
  // Uses db.transaction() to prevent TOCTOU races between concurrent budget checks.
  const reservationId = request.request_id;
  const atomicCheck = db.transaction(() => {
    // Prune stale reservations first (self-expiring TTL safety net)
    try {
      db.prepare("DELETE FROM pending_reservations WHERE expires_at <= datetime('now')").run();
    } catch (e: unknown) {
      logger.debug("budget", "pending_reservations table not found — pre-0.9.7 migration (skipping)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }

    const dailySpend   = getDailySpend(db, division);
    const monthlySpend = getMonthlySpend(db, division);

    // Check daily limit
    if (budget.daily_limit_usd !== null) {
      const projectedDaily = dailySpend + cost;
      if (projectedDaily > budget.daily_limit_usd) {
        return {
          verdict: "PAUSE" as const,
          reason:  `Daily budget exceeded: $${projectedDaily.toFixed(4)} > $${budget.daily_limit_usd.toFixed(4)}`,
          rule_id: "budget.daily_exceeded",
          dailySpend, monthlySpend,
        };
      }
    }

    // Check monthly limit
    if (budget.monthly_limit_usd !== null) {
      const projectedMonthly = monthlySpend + cost;
      if (projectedMonthly > budget.monthly_limit_usd) {
        return {
          verdict: "PAUSE" as const,
          reason:  `Monthly budget exceeded: $${projectedMonthly.toFixed(4)} > $${budget.monthly_limit_usd.toFixed(4)}`,
          rule_id: "budget.monthly_exceeded",
          dailySpend, monthlySpend,
        };
      }
    }

    // Budget OK — atomically insert reservation to block concurrent over-spend
    try {
      db.prepare(`
        INSERT OR IGNORE INTO pending_reservations (id, division_code, amount_usd, reserved_at, expires_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now', '+1 hour'))
      `).run(reservationId, division, cost);
    } catch (e: unknown) {
      logger.debug("budget", "pending_reservations table not found — pre-0.9.7 migration (skipping)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }

    return { verdict: "PASS" as const, dailySpend, monthlySpend };
  });

  const result = atomicCheck();

  if (result.verdict === "PAUSE") {
    checks.push({
      rule_id:     result.rule_id ?? "budget.exceeded",
      rule_source: BUDGET_SOURCE,
      matched:     true,
      verdict:     "PAUSE" as const,
      reason:      result.reason ?? "Budget exceeded",
    });
    return {
      stage:         "budget",
      verdict:       "PAUSE",
      duration_ms:   Date.now() - start,
      rules_checked: checks,
    };
  }

  // Build warning checks based on threshold proximity
  const { dailySpend, monthlySpend } = result;

  if (budget.daily_limit_usd !== null) {
    const projectedDaily = dailySpend + cost;
    const pct = (projectedDaily / budget.daily_limit_usd) * 100;
    if (pct >= budget.alert_threshold_percent) {
      checks.push({
        rule_id:     "budget.daily_warn",
        rule_source: BUDGET_SOURCE,
        matched:     true,
        verdict:     "WARN" as const,
        reason:      `Daily budget at ${pct.toFixed(0)}% ($${projectedDaily.toFixed(4)}/$${budget.daily_limit_usd.toFixed(4)})`,
      });
    }
  }

  if (budget.monthly_limit_usd !== null) {
    const projectedMonthly = monthlySpend + cost;
    const pct = (projectedMonthly / budget.monthly_limit_usd) * 100;
    if (pct >= budget.alert_threshold_percent) {
      checks.push({
        rule_id:     "budget.monthly_warn",
        rule_source: BUDGET_SOURCE,
        matched:     true,
        verdict:     "WARN" as const,
        reason:      `Monthly budget at ${pct.toFixed(0)}% ($${projectedMonthly.toFixed(4)}/$${budget.monthly_limit_usd.toFixed(4)})`,
      });
    }
  }

  if (checks.length === 0) {
    checks.push({
      rule_id:     "budget.pass",
      rule_source: BUDGET_SOURCE,
      matched:     false,
      verdict:     "PASS" as const,
      reason:      "Within budget limits",
    });
  }

  const hasWarn = checks.some((c) => c.verdict === "WARN");
  return {
    stage:         "budget",
    verdict:       hasWarn ? "WARN" : "PASS",
    duration_ms:   Date.now() - start,
    rules_checked: checks,
  };
}

/**
 * Release a budget reservation after an action completes (or fails).
 * Called by ActionExecutor to clean up reservations when actions finish.
 *
 * @param db         Open database handle
 * @param requestId  The reservation ID (= ActionRequest.request_id)
 */
export function releaseBudgetReservation(db: Database, requestId: string): void {
  try {
    db.prepare("DELETE FROM pending_reservations WHERE id = ?").run(requestId);
  } catch (e: unknown) {
    logger.debug("budget", "pending_reservations table not found — pre-0.9.7 migration (skipping)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }
}


/** Load budget limits for a division from the cost_budgets table. */
export function getBudget(db: Database, division: string): BudgetRow | null {
  const row = db
    .prepare<[string], BudgetRow>(
      `SELECT division_code, monthly_limit_usd, daily_limit_usd, alert_threshold_percent
       FROM cost_budgets
       WHERE division_code = ?`,
    )
    .get(division);

  return row ?? null;
}

/**
 * Sum today's cost_ledger entries + unexpired pending_reservations for a division.
 * Including pending reservations prevents TOCTOU over-spend.
 */
export function getDailySpend(db: Database, division: string): number {
  const ledger = db
    .prepare<[string], SpendRow>(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM cost_ledger
       WHERE division_code = ?
         AND date(timestamp) = date('now')`,
    )
    .get(division);

  let pending = 0;
  try {
    const pendingRow = db
      .prepare<[string], SpendRow>(
        `SELECT COALESCE(SUM(amount_usd), 0) AS total
         FROM pending_reservations
         WHERE division_code = ?
           AND expires_at > datetime('now')`,
      )
      .get(division);
    pending = pendingRow?.total ?? 0;
  } catch (e: unknown) {
    logger.debug("budget", "pending_reservations table not found — pre-0.9.7 migration (skipping)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }

  return (ledger?.total ?? 0) + pending;
}

/**
 * Sum this calendar-month's cost_ledger entries + unexpired pending_reservations.
 * Including pending reservations prevents TOCTOU over-spend.
 */
export function getMonthlySpend(db: Database, division: string): number {
  const ledger = db
    .prepare<[string], SpendRow>(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM cost_ledger
       WHERE division_code = ?
         AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`,
    )
    .get(division);

  let pending = 0;
  try {
    const pendingRow = db
      .prepare<[string], SpendRow>(
        `SELECT COALESCE(SUM(amount_usd), 0) AS total
         FROM pending_reservations
         WHERE division_code = ?
           AND expires_at > datetime('now')`,
      )
      .get(division);
    pending = pendingRow?.total ?? 0;
  } catch (e: unknown) {
    logger.debug("budget", "pending_reservations table not found — pre-0.9.7 migration (skipping)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }

  return (ledger?.total ?? 0) + pending;
}
