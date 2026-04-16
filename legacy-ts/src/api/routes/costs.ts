// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11b: Cost REST Endpoints
 *
 * GET    /api/v1/costs               — cost breakdown (filterable by division/agent/period)
 *
 * Query params:
 *   division  — filter by division code
 *   agent     — filter by agent ID
 *   period    — 1h | 24h | 7d | 30d (default: 7d)
 *   from, to  — ISO date strings for custom range (overrides period)
 */

import Database from "better-sqlite3";
import { Hono } from "hono";
import { SidjuaError }  from "../../core/error-codes.js";
import { createLogger } from "../../core/logger.js";
import { hasTable }     from "../../core/db/helpers.js";
import { requireScope } from "../middleware/require-scope.js";

const logger = createLogger("api-costs");


export interface CostRouteServices {
  db: InstanceType<typeof Database>;
}


const PERIOD_MS: Record<string, number> = {
  "1h":  1   * 60 * 60 * 1000,
  "24h": 24  * 60 * 60 * 1000,
  "7d":  7   * 24 * 60 * 60 * 1000,
  "30d": 30  * 24 * 60 * 60 * 1000,
};


export function registerCostRoutes(app: Hono, services: CostRouteServices): void {
  const { db } = services;

  // ---- GET /api/v1/costs -------------------------------------------------

  /** Whitelist of allowed filter params for GET /api/v1/costs (column names hardcoded; unknown params rejected). */
  const COST_FILTER_PARAMS = new Set(["division", "agent", "period", "from", "to"]);

  app.get("/api/v1/costs", requireScope("readonly"), (c) => {
    // Reject unknown query params
    for (const key of Object.keys(c.req.queries())) {
      if (!COST_FILTER_PARAMS.has(key)) {
        return c.json({ error: `Invalid filter parameter: ${key}` }, 400);
      }
    }

    const divisionParam = c.req.query("division");
    const agentParam    = c.req.query("agent");
    const periodParam   = c.req.query("period") ?? "7d";
    const fromParam     = c.req.query("from");
    const toParam       = c.req.query("to");

    // Calculate time range
    let fromMs: number;
    let toMs:   number = Date.now();

    if (fromParam !== undefined && toParam !== undefined) {
      fromMs = new Date(fromParam).getTime();
      toMs   = new Date(toParam).getTime();
      if (isNaN(fromMs) || isNaN(toMs)) {
        throw SidjuaError.from("INPUT-003", "Invalid from/to date format — use ISO 8601");
      }
    } else if (periodParam !== undefined && PERIOD_MS[periodParam] !== undefined) {
      fromMs = toMs - PERIOD_MS[periodParam]!;
    } else {
      throw SidjuaError.from("INPUT-003", `Invalid period: ${periodParam}. Use 1h | 24h | 7d | 30d`);
    }

    const fromIso = new Date(fromMs).toISOString();
    const toIso   = new Date(toMs).toISOString();

    if (!hasTable(db, "cost_ledger")) {
      logger.info("cost_ledger_missing", "cost_ledger table not yet created — run sidjua apply first", {});
      return c.json({
        period:    { from: fromIso, to: toIso },
        total:     { total_usd: 0, total_input_tokens: 0, total_output_tokens: 0, entries: 0 },
        breakdown: [],
      });
    }

    const conditions: string[] = ["timestamp >= ? AND timestamp <= ?"];
    const params: unknown[]    = [fromIso, toIso];

    if (divisionParam) { conditions.push("division_code = ?"); params.push(divisionParam); }
    if (agentParam)    { conditions.push("agent_id = ?");      params.push(agentParam); }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const total = db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total_usd,
              COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
              COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
              COUNT(*) AS entries
       FROM cost_ledger ${where}`,
    ).get(...params) as Record<string, number> | undefined;

    const breakdown = db.prepare(
      `SELECT division_code, agent_id,
              COALESCE(SUM(cost_usd), 0) AS cost_usd,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COUNT(*) AS entries
       FROM cost_ledger ${where}
       GROUP BY division_code, agent_id
       ORDER BY cost_usd DESC`,
    ).all(...params) as Record<string, unknown>[];

    return c.json({
      period:    { from: fromIso, to: toIso },
      total:     total ?? { total_usd: 0, total_input_tokens: 0, total_output_tokens: 0, entries: 0 },
      breakdown,
    });
  });
}
