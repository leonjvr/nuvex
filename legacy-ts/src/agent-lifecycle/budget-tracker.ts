// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: BudgetTracker
 *
 * Real-time budget tracking — extends (wraps) Phase 6 CostTracker.
 * Adds:
 *   - Per-agent running totals
 *   - Per-division running totals (synced from cost_ledger)
 *   - Org total
 *   - Period-aware (daily/monthly reset via DB queries)
 *   - Alert thresholds: 80% → warning, 95% → critical, 100% → exceeded
 */

import { parse as parseYaml } from "yaml";
import type { Database } from "../utils/db.js";
import { CostTracker } from "../provider/cost-tracker.js";
import type { BudgetAlert, AlertLevel } from "./types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("budget-tracker");


const ALERT_THRESHOLDS: { level: AlertLevel; percent: number }[] = [
  { level: "exceeded", percent: 100 },
  { level: "critical", percent: 95 },
  { level: "warning", percent: 80 },
];


interface SpendRow {
  total: number;
}

interface DivisionBudgetRow {
  division: string;
  spent_usd: number;
  limit_usd: number;
  period_type: string;
  period_start: string;
}

interface AgentConfigRow {
  id: string;
  config_yaml: string;
}


/**
 * Augments Phase 6 CostTracker with agent-level and enhanced division tracking.
 * Does NOT replace CostTracker — it wraps it for backwards compatibility.
 */
export class BudgetTracker {
  /** Underlying Phase 6 CostTracker (division-level checks). */
  readonly costTracker: CostTracker;

  constructor(private readonly db: Database) {
    this.costTracker = new CostTracker(db);
  }

  // ---------------------------------------------------------------------------
  // Per-agent spend queries
  // ---------------------------------------------------------------------------

  /**
   * Return total cost for an agent in the current calendar month.
   */
  getAgentMonthlySpend(agentId: string): number {
    try {
      const row = this.db
        .prepare<[string], SpendRow>(
          `SELECT COALESCE(SUM(cost_usd), 0) AS total
           FROM cost_ledger
           WHERE agent_id = ?
             AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`,
        )
        .get(agentId);
      return row?.total ?? 0;
    } catch (e: unknown) {
      logger.error("budget-tracker", "Agent spend DB query failed — blocking spend (fail closed)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return Number.POSITIVE_INFINITY;
    }
  }

  /**
   * Return total cost for an agent today (UTC).
   */
  getAgentDailySpend(agentId: string): number {
    try {
      const row = this.db
        .prepare<[string], SpendRow>(
          `SELECT COALESCE(SUM(cost_usd), 0) AS total
           FROM cost_ledger
           WHERE agent_id = ?
             AND date(timestamp) = date('now')`,
        )
        .get(agentId);
      return row?.total ?? 0;
    } catch (e: unknown) {
      logger.error("budget-tracker", "Agent daily spend DB query failed — blocking spend (fail closed)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return Number.POSITIVE_INFINITY;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-division spend (delegates to CostTracker)
  // ---------------------------------------------------------------------------

  getDivisionMonthlySpend(divisionCode: string): number {
    return this.costTracker.getMonthlySpend(divisionCode);
  }

  getDivisionDailySpend(divisionCode: string): number {
    return this.costTracker.getDailySpend(divisionCode);
  }

  // ---------------------------------------------------------------------------
  // Org total
  // ---------------------------------------------------------------------------

  /**
   * Return total cost across all divisions this month.
   */
  getOrgMonthlySpend(): number {
    try {
      const row = this.db
        .prepare<[], SpendRow>(
          `SELECT COALESCE(SUM(cost_usd), 0) AS total
           FROM cost_ledger
           WHERE strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`,
        )
        .get();
      return row?.total ?? 0;
    } catch (e: unknown) {
      logger.error("budget-tracker", "Org spend DB query failed — blocking spend (fail closed)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return Number.POSITIVE_INFINITY;
    }
  }

  // ---------------------------------------------------------------------------
  // Alert detection
  // ---------------------------------------------------------------------------

  /**
   * Check all agents and divisions for budget alerts.
   * Returns any alerts that have crossed threshold boundaries.
   */
  checkAlerts(): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];
    const now = new Date().toISOString();

    // Check agent-level alerts
    const agentAlerts = this.checkAgentAlerts(now);
    alerts.push(...agentAlerts);

    // Check division-level alerts
    const divisionAlerts = this.checkDivisionAlerts(now);
    alerts.push(...divisionAlerts);

    return alerts;
  }

  /**
   * Check a specific agent's budget consumption and return alerts.
   */
  checkAgentBudgetAlert(agentId: string, agentMonthlyLimit: number): BudgetAlert | null {
    const spent = this.getAgentMonthlySpend(agentId);
    const pct = agentMonthlyLimit > 0 ? (spent / agentMonthlyLimit) * 100 : 0;

    for (const threshold of ALERT_THRESHOLDS) {
      if (pct >= threshold.percent) {
        return {
          level: threshold.level,
          scope: "agent",
          scope_id: agentId,
          current_usd: spent,
          limit_usd: agentMonthlyLimit,
          percent_used: pct,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return null;
  }

  /**
   * Check a division's budget consumption.
   */
  checkDivisionBudgetAlert(divisionCode: string, monthlyLimit: number): BudgetAlert | null {
    const spent = this.getDivisionMonthlySpend(divisionCode);
    const pct = monthlyLimit > 0 ? (spent / monthlyLimit) * 100 : 0;

    for (const threshold of ALERT_THRESHOLDS) {
      if (pct >= threshold.percent) {
        return {
          level: threshold.level,
          scope: "division",
          scope_id: divisionCode,
          current_usd: spent,
          limit_usd: monthlyLimit,
          percent_used: pct,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private checkAgentAlerts(now: string): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];

    try {
      const agents = this.db
        .prepare<[], AgentConfigRow>(
          "SELECT id, config_yaml FROM agent_definitions WHERE status != 'deleted'",
        )
        .all() as AgentConfigRow[];

      for (const agent of agents) {
        try {
          const config = parseYaml(agent.config_yaml) as { budget?: { per_month_usd?: number } };
          const limit = config.budget?.per_month_usd;

          if (limit === undefined || limit <= 0) continue;

          const spent = this.getAgentMonthlySpend(agent.id);
          const pct = (spent / limit) * 100;

          for (const threshold of ALERT_THRESHOLDS) {
            if (pct >= threshold.percent) {
              alerts.push({
                level: threshold.level,
                scope: "agent",
                scope_id: agent.id,
                current_usd: spent,
                limit_usd: limit,
                percent_used: pct,
                timestamp: now,
              });
              break; // Only highest alert per agent
            }
          }
        } catch (e: unknown) { logger.debug("budget-tracker", "Agent config YAML parse failed — using defaults", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }
      }
    } catch (e: unknown) { logger.debug("budget-tracker", "Agent budget table not found — skipping limit check (pre-migration)", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }

    return alerts;
  }

  private checkDivisionAlerts(now: string): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];

    try {
      const rows = this.db
        .prepare<[], DivisionBudgetRow>("SELECT * FROM division_budgets")
        .all() as DivisionBudgetRow[];

      for (const row of rows) {
        if (row.limit_usd <= 0) continue;

        const spent = this.getDivisionMonthlySpend(row.division);
        const pct = (spent / row.limit_usd) * 100;

        for (const threshold of ALERT_THRESHOLDS) {
          if (pct >= threshold.percent) {
            alerts.push({
              level: threshold.level,
              scope: "division",
              scope_id: row.division,
              current_usd: spent,
              limit_usd: row.limit_usd,
              percent_used: pct,
              timestamp: now,
            });
            break;
          }
        }
      }
    } catch (e: unknown) { logger.debug("budget-tracker", "Division budget table not found — skipping limit check (pre-migration)", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }

    return alerts;
  }
}
