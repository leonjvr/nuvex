// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: BudgetResolver
 *
 * 4-level budget cascade: org → division → agent → task.
 * ALL levels must pass. Lowest limit wins.
 *
 * Integrates with Phase 5 Pre-Action Pipeline Stage 3 (BUDGET).
 * The existing cost_budgets table provides org/division limits.
 * The agent_definitions and agent_budgets tables provide agent limits.
 */

import { parse as parseYaml } from "yaml";
import type { Database } from "../utils/db.js";
import type { BudgetResolution, BudgetCheckDetail, BudgetLevel } from "./types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("budget-resolver");


interface OrgBudgetRow {
  division_code: string;
  monthly_limit_usd: number | null;
  daily_limit_usd: number | null;
  alert_threshold_percent: number;
}

interface DivisionBudgetRow {
  division: string;
  period_type: string;
  spent_usd: number;
  limit_usd: number;
}

interface AgentBudgetRow {
  agent_id: string;
  period_type: string;
  spent_usd: number;
  limit_usd: number;
  token_limit: number | null;
}

interface AgentConfigRow {
  config_yaml: string;
}

interface SpendRow {
  total: number;
}


export class BudgetResolver {
  constructor(private readonly db: Database) {}

  /**
   * Resolve whether an action with the given estimated cost is within budget.
   * Checks all 4 levels. If ANY blocks, the result is denied.
   *
   * @param agentId      - The agent attempting the action
   * @param divisionCode - The agent's division
   * @param estimatedCostUsd - Estimated cost in USD
   * @param taskBudgetUsd    - Optional per-task override
   */
  resolve(
    agentId: string,
    divisionCode: string,
    estimatedCostUsd: number,
    taskBudgetUsd?: number,
  ): BudgetResolution {
    const details: BudgetCheckDetail[] = [];
    let lowestLimit: number | null = null;
    let blockedBy: BudgetLevel | undefined;
    let nearLimit = false;

    const update = (check: BudgetCheckDetail): void => {
      details.push(check);
      if (!check.allowed) blockedBy = check.level;
      if (check.limit_usd !== null) {
        if (lowestLimit === null || check.limit_usd < lowestLimit) {
          lowestLimit = check.limit_usd;
        }
        const ratio = check.limit_usd > 0 ? (check.current_usd + estimatedCostUsd) / check.limit_usd : 0;
        if (ratio >= 0.8) nearLimit = true;
      }
    };

    // ── Level 1: Org ───────────────────────────────────────────────────────
    update(this.checkOrgLevel(divisionCode, estimatedCostUsd));

    // ── Level 2: Division ──────────────────────────────────────────────────
    update(this.checkDivisionLevel(divisionCode, estimatedCostUsd));

    // ── Level 3: Agent ─────────────────────────────────────────────────────
    update(this.checkAgentLevel(agentId, estimatedCostUsd));

    // ── Level 4: Task ──────────────────────────────────────────────────────
    update(this.checkTaskLevel(agentId, estimatedCostUsd, taskBudgetUsd));

    const allowed = blockedBy === undefined;

    return {
      allowed,
      effective_limit_usd: lowestLimit,
      ...(blockedBy !== undefined ? { blocked_by: blockedBy } : {}),
      details,
      near_limit: nearLimit,
    };
  }

  // ---------------------------------------------------------------------------
  // Level checkers
  // ---------------------------------------------------------------------------

  private checkOrgLevel(divisionCode: string, estimatedCost: number): BudgetCheckDetail {
    try {
      const budget = this.db
        .prepare<[string], OrgBudgetRow>(
          `SELECT division_code, monthly_limit_usd, daily_limit_usd, alert_threshold_percent
           FROM cost_budgets WHERE division_code = ?`,
        )
        .get(divisionCode);

      if (budget === undefined) {
        return { level: "org", allowed: true, current_usd: 0, limit_usd: null };
      }

      const currentMonthly = this.getMonthlySpend(divisionCode);
      const limit = budget.monthly_limit_usd;

      if (limit !== null && currentMonthly + estimatedCost > limit) {
        return {
          level: "org",
          allowed: false,
          current_usd: currentMonthly,
          limit_usd: limit,
          reason: `Org/division monthly limit $${limit} would be exceeded (current: $${currentMonthly.toFixed(4)})`,
        };
      }

      return { level: "org", allowed: true, current_usd: currentMonthly, limit_usd: limit };
    } catch (e: unknown) {
      // Security: fail-closed — deny action when budget DB is unavailable
      logger.error("budget-resolver", "Org budget DB query failed — denying action (fail-closed)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return { level: "org", allowed: false, current_usd: 0, limit_usd: 0 };
    }
  }

  private checkDivisionLevel(divisionCode: string, estimatedCost: number): BudgetCheckDetail {
    try {
      const row = this.db
        .prepare<[string], DivisionBudgetRow>(
          "SELECT * FROM division_budgets WHERE division = ?",
        )
        .get(divisionCode);

      if (row === undefined) {
        return { level: "division", allowed: true, current_usd: 0, limit_usd: null };
      }

      const projected = row.spent_usd + estimatedCost;
      if (projected > row.limit_usd) {
        return {
          level: "division",
          allowed: false,
          current_usd: row.spent_usd,
          limit_usd: row.limit_usd,
          reason: `Division "${divisionCode}" ${row.period_type} limit $${row.limit_usd} would be exceeded`,
        };
      }

      return {
        level: "division",
        allowed: true,
        current_usd: row.spent_usd,
        limit_usd: row.limit_usd,
      };
    } catch (e: unknown) {
      // Security: fail-closed — deny action when budget DB is unavailable
      logger.error("budget-resolver", "Division budget DB query failed — denying action (fail-closed)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return { level: "division", allowed: false, current_usd: 0, limit_usd: 0 };
    }
  }

  private checkAgentLevel(agentId: string, estimatedCost: number): BudgetCheckDetail {
    try {
      // Get agent's monthly limit from config_yaml
      const configRow = this.db
        .prepare<[string], AgentConfigRow>(
          "SELECT config_yaml FROM agent_definitions WHERE id = ?",
        )
        .get(agentId);

      let agentMonthlyLimit: number | null = null;

      if (configRow !== undefined) {
        try {
          const config = parseYaml(configRow.config_yaml) as { budget?: { per_month_usd?: number } };
          agentMonthlyLimit = config.budget?.per_month_usd ?? null;
        } catch (e: unknown) { logger.debug("budget-resolver", "Agent config YAML parse failed — using defaults", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }
      }

      // Get agent's spent amount from agent_budgets
      const budgetRow = this.db
        .prepare<[string], AgentBudgetRow>(
          `SELECT * FROM agent_budgets
           WHERE agent_id = ? AND period_type = 'monthly'
             AND period_start = strftime('%Y-%m-01', 'now')`,
        )
        .get(agentId);

      const currentSpent = budgetRow?.spent_usd ?? 0;

      if (agentMonthlyLimit !== null) {
        const projected = currentSpent + estimatedCost;
        if (projected > agentMonthlyLimit) {
          return {
            level: "agent",
            allowed: false,
            current_usd: currentSpent,
            limit_usd: agentMonthlyLimit,
            reason: `Agent "${agentId}" monthly limit $${agentMonthlyLimit} would be exceeded`,
          };
        }
      }

      return {
        level: "agent",
        allowed: true,
        current_usd: currentSpent,
        limit_usd: agentMonthlyLimit,
      };
    } catch (e: unknown) {
      // Security: fail-closed — deny action when budget DB is unavailable
      logger.error("budget-resolver", "Agent budget DB query failed — denying action (fail-closed)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return { level: "agent", allowed: false, current_usd: 0, limit_usd: 0 };
    }
  }

  private checkTaskLevel(
    agentId: string,
    estimatedCost: number,
    taskBudgetUsd?: number,
  ): BudgetCheckDetail {
    // Task-level budget: check per_task_usd from agent config, or explicit task override
    try {
      let perTaskLimit: number | null = taskBudgetUsd ?? null;

      if (perTaskLimit === null) {
        const configRow = this.db
          .prepare<[string], AgentConfigRow>(
            "SELECT config_yaml FROM agent_definitions WHERE id = ?",
          )
          .get(agentId);

        if (configRow !== undefined) {
          const config = parseYaml(configRow.config_yaml) as { budget?: { per_task_usd?: number } };
          perTaskLimit = config.budget?.per_task_usd ?? null;
        }
      }

      if (perTaskLimit !== null && estimatedCost > perTaskLimit) {
        return {
          level: "task",
          allowed: false,
          current_usd: 0,
          limit_usd: perTaskLimit,
          reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-task limit $${perTaskLimit}`,
        };
      }

      return { level: "task", allowed: true, current_usd: 0, limit_usd: perTaskLimit };
    } catch (e: unknown) {
      // Security: fail-closed — deny action when budget DB is unavailable
      logger.error("budget-resolver", "Task budget DB query failed — denying action (fail-closed)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return { level: "task", allowed: false, current_usd: 0, limit_usd: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getMonthlySpend(divisionCode: string): number {
    // Security: errors propagate to the caller's fail-closed catch block rather
    // than returning 0, which could allow actions when the DB is unavailable.
    const row = this.db
      .prepare<[string], SpendRow>(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM cost_ledger
         WHERE division_code = ?
           AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`,
      )
      .get(divisionCode);
    return row?.total ?? 0;
  }

  /**
   * Record actual cost against the agent budget tracking table.
   * Called after successful action completion.
   */
  recordAgentCost(agentId: string, costUsd: number, periodStart?: string): void {
    const period = periodStart ?? new Date().toISOString().slice(0, 7) + "-01";

    try {
      // Upsert monthly period row
      this.db
        .prepare<[string, string, number], void>(`
          INSERT INTO agent_budgets (agent_id, period_start, period_type, spent_usd, limit_usd)
          VALUES (?, ?, 'monthly', ?, 0)
          ON CONFLICT(agent_id, period_start, period_type)
          DO UPDATE SET spent_usd = spent_usd + excluded.spent_usd
        `)
        .run(agentId, period, costUsd);
    } catch (e: unknown) { logger.debug("budget-resolver", "agent_budgets table not found — skipping (pre-migration)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      // If table doesn't exist yet, silently skip
    }
  }

  /**
   * Atomically check agent budget availability and record the spend.
   *
   * Uses better-sqlite3's `.transaction()` (which issues BEGIN IMMEDIATE under
   * the hood) to acquire an exclusive write lock before reading the current
   * spend. This prevents two concurrent tasks from both passing the check before
   * either records its cost, which would allow overspending.
   *
   * @returns true if the cost was within budget and has been recorded;
   *          false if the agent's monthly budget would be exceeded (nothing recorded).
   */
  checkAndSpend(agentId: string, estimatedCostUsd: number, periodStart?: string): boolean {
    const period = periodStart ?? new Date().toISOString().slice(0, 7) + "-01";

    const checkAndSpendTx = this.db.transaction(() => {
      // Read current spend + agent monthly limit inside the write transaction
      const budgetRow = this.db
        .prepare<[string], AgentBudgetRow>(
          `SELECT * FROM agent_budgets
           WHERE agent_id = ? AND period_type = 'monthly'
             AND period_start = strftime('%Y-%m-01', 'now')`,
        )
        .get(agentId);

      const currentSpent = budgetRow?.spent_usd ?? 0;

      // Determine agent monthly limit from config
      let agentMonthlyLimit: number | null = null;
      try {
        const configRow = this.db
          .prepare<[string], AgentConfigRow>(
            "SELECT config_yaml FROM agent_definitions WHERE id = ?",
          )
          .get(agentId);
        if (configRow !== undefined) {
          const config = parseYaml(configRow.config_yaml) as { budget?: { per_month_usd?: number } };
          agentMonthlyLimit = config.budget?.per_month_usd ?? null;
        }
      } catch (e: unknown) { logger.debug("budget-resolver", "Agent config parse failed — proceeding without per-task limit", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }

      if (agentMonthlyLimit !== null && currentSpent + estimatedCostUsd > agentMonthlyLimit) {
        return false; // budget exceeded — transaction commits a read-only check, no write
      }

      // Within budget — record the spend atomically in the same transaction
      this.db
        .prepare<[string, string, number], void>(`
          INSERT INTO agent_budgets (agent_id, period_start, period_type, spent_usd, limit_usd)
          VALUES (?, ?, 'monthly', ?, 0)
          ON CONFLICT(agent_id, period_start, period_type)
          DO UPDATE SET spent_usd = spent_usd + excluded.spent_usd
        `)
        .run(agentId, period, estimatedCostUsd);

      return true;
    });

    try {
      return checkAndSpendTx() as boolean;
    } catch (e: unknown) {
      // Budget table missing or query error — fail closed.
      // Run 'sidjua apply' to create budget tables before using governed agents.
      logger.error("budget-resolver", "checkAndSpend failed — blocking spend (fail-closed)", {
        metadata: { error: e instanceof Error ? e.message : String(e) },
      });
      return false;
    }
  }
}
