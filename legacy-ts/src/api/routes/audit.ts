// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11b: Audit REST Endpoints
 *
 * GET    /api/v1/audit               — paginated, filterable audit log
 * GET    /api/v1/audit/tasks/:id     — full audit trail for a specific task
 *
 * Query params for GET /audit:
 *   division  — filter by division code
 *   agent     — filter by agent ID
 *   event     — filter by action_type
 *   from, to  — ISO date range
 *   limit     — default 100, max 500
 *   offset    — default 0
 */

import Database from "better-sqlite3";
import { Hono } from "hono";
import { SidjuaError }          from "../../core/error-codes.js";
import { createLogger }          from "../../core/logger.js";
import { hasTable }              from "../../core/db/helpers.js";
import { AuditService }          from "../../core/audit/audit-service.js";
import { sanitizeLikePattern }   from "../../utils/sql-utils.js";
import type { AuditFilters }     from "../../core/audit/audit-service.js";
import { requireScope }          from "../middleware/require-scope.js";

const logger = createLogger("api-audit");


export interface AuditRouteServices {
  db: InstanceType<typeof Database>;
}


export function registerAuditRoutes(app: Hono, services: AuditRouteServices): void {
  const { db } = services;

  // ---- GET /api/v1/audit -------------------------------------------------

  /**
   * Whitelist of query params accepted by GET /api/v1/audit.
   * Each entry maps the param name to the exact SQL fragment (column whitelist).
   * Values are always bound as parameters — the column name is hardcoded here, never derived from user input.
   */
  const AUDIT_FILTER_MAP = new Map<string, string>([
    ["division", "division_code = ?"],
    ["agent",    "agent_id = ?"],
    ["event",    "action_type = ?"],
    ["from",     "timestamp >= ?"],
    ["to",       "timestamp <= ?"],
  ]);

  app.get("/api/v1/audit", requireScope("readonly"), (c) => {
    const limitStr    = c.req.query("limit")    ?? "100";
    const offsetStr   = c.req.query("offset")   ?? "0";

    const limit  = parseInt(limitStr, 10);
    const offset = parseInt(offsetStr, 10);

    if (isNaN(limit)  || limit  < 1 || limit  > 500) throw SidjuaError.from("INPUT-003", "limit must be 1–500");
    if (isNaN(offset) || offset < 0)                  throw SidjuaError.from("INPUT-003", "offset must be ≥ 0");

    // Validate all query params — reject any not in the whitelist
    // (limit and offset are already consumed above)
    const PAGINATION_PARAMS = new Set(["limit", "offset"]);
    for (const key of Object.keys(c.req.queries())) {
      if (!AUDIT_FILTER_MAP.has(key) && !PAGINATION_PARAMS.has(key)) {
        return c.json({ error: `Invalid filter parameter: ${key}` }, 400);
      }
    }

    const conditions: string[] = [];
    const params: unknown[]    = [];

    for (const [paramName, sqlFragment] of AUDIT_FILTER_MAP) {
      const val = c.req.query(paramName);
      if (val !== undefined) {
        conditions.push(sqlFragment);
        params.push(val);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    if (!hasTable(db, "audit_trail")) {
      logger.info("audit_trail_missing", "audit_trail table not yet created — run sidjua apply first", {});
      return c.json({ entries: [], total: 0, limit, offset });
    }

    const countRow = db.prepare(`SELECT COUNT(*) AS total FROM audit_trail ${where}`).get(...params) as { total: number } | undefined;
    const total    = countRow?.total ?? 0;

    const entries = db
      .prepare(`SELECT * FROM audit_trail ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Record<string, unknown>[];

    return c.json({ entries, total, limit, offset });
  });

  // ---- GET /api/v1/audit/tasks/:id ---------------------------------------

  app.get("/api/v1/audit/tasks/:id", requireScope("readonly"), (c) => {
    const taskId = c.req.param("id");

    if (!hasTable(db, "audit_trail")) {
      return c.json({ task_id: taskId, events: [] });
    }

    const safePattern = `%${sanitizeLikePattern(taskId)}%`;
    const events = db
      .prepare("SELECT * FROM audit_trail WHERE parent_task_id = ? OR metadata LIKE ? ESCAPE '\\' ORDER BY timestamp")
      .all(taskId, safePattern) as Record<string, unknown>[];

    return c.json({ task_id: taskId, events });
  });

  // ==========================================================================
  // Compliance reporting endpoints (GET /api/v1/audit/report, /violations, …)
  // ==========================================================================

  const svc = new AuditService(db);

  /**
   * Parse common query params from a raw query dictionary into AuditFilters.
   * Separated from Hono Context to keep types simple and testable.
   */
  function parseFilters(query: Record<string, string | undefined>): AuditFilters {
    const limitStr  = query["limit"]  ?? "50";
    const offsetStr = query["offset"] ?? "0";
    const limit  = parseInt(limitStr,  10);
    const offset = parseInt(offsetStr, 10);

    if (isNaN(limit)  || limit  < 1 || limit  > 1000) throw SidjuaError.from("INPUT-003", "limit must be 1–1000");
    if (isNaN(offset) || offset < 0)                   throw SidjuaError.from("INPUT-003", "offset must be ≥ 0");

    const severityRaw = query["severity"];
    const VALID_SEV   = new Set(["low", "medium", "high", "critical"]);
    if (severityRaw !== undefined && !VALID_SEV.has(severityRaw)) {
      throw SidjuaError.from("INPUT-003", "severity must be low|medium|high|critical");
    }

    const filters: AuditFilters = { limit, offset };
    if (query["division"]   !== undefined) filters.division   = query["division"];
    if (query["agent"]      !== undefined) filters.agentId    = query["agent"];
    if (query["since"]      !== undefined) filters.since      = query["since"];
    if (query["until"]      !== undefined) filters.until      = query["until"];
    if (query["policyType"] !== undefined) filters.policyType = query["policyType"];
    if (severityRaw !== undefined) {
      filters.severity = severityRaw as "low" | "medium" | "high" | "critical";
    }
    return filters;
  }

  function ctxQuery(c: { req: { query(k: string): string | undefined } }, k: string): string | undefined {
    return c.req.query(k);
  }

  function parseCtxFilters(c: { req: { query(k: string): string | undefined } }): AuditFilters {
    return parseFilters({
      limit:      ctxQuery(c, "limit"),
      offset:     ctxQuery(c, "offset"),
      division:   ctxQuery(c, "division"),
      agent:      ctxQuery(c, "agent"),
      since:      ctxQuery(c, "since"),
      until:      ctxQuery(c, "until"),
      policyType: ctxQuery(c, "policyType"),
      severity:   ctxQuery(c, "severity"),
    });
  }

  // ---- GET /api/v1/audit/report -------------------------------------------

  app.get("/api/v1/audit/report", requireScope("readonly"), async (c) => {
    const filters = parseCtxFilters(c);
    const report  = await svc.generateReport(filters);
    return c.json(report);
  });

  // ---- GET /api/v1/audit/violations ----------------------------------------

  app.get("/api/v1/audit/violations", requireScope("readonly"), async (c) => {
    const filters    = parseCtxFilters(c);
    const violations = await svc.getViolations(filters);
    // Count without pagination for the header
    const countFilters: AuditFilters = {};
    if (filters.division)   countFilters.division   = filters.division;
    if (filters.agentId)    countFilters.agentId    = filters.agentId;
    if (filters.since)      countFilters.since      = filters.since;
    if (filters.until)      countFilters.until      = filters.until;
    if (filters.severity)   countFilters.severity   = filters.severity;
    if (filters.policyType) countFilters.policyType = filters.policyType;
    const total = svc.getViolationCount(countFilters);
    c.header("X-Total-Count", String(total));
    return c.json(violations);
  });

  // ---- GET /api/v1/audit/agents --------------------------------------------

  app.get("/api/v1/audit/agents", requireScope("readonly"), async (c) => {
    const filters = parseCtxFilters(c);
    const agents  = await svc.getAgentTrust(filters);
    c.header("X-Total-Count", String(agents.length));
    return c.json(agents);
  });

  // ---- GET /api/v1/audit/summary ------------------------------------------

  app.get("/api/v1/audit/summary", requireScope("readonly"), async (c) => {
    const filters = parseCtxFilters(c);
    const summary = await svc.getSummary(filters);
    return c.json(summary);
  });

  // ---- GET /api/v1/audit/export -------------------------------------------

  app.get("/api/v1/audit/export", requireScope("readonly"), async (c) => {
    const fmt = (c.req.query("format") ?? "json").toLowerCase();
    if (fmt !== "csv" && fmt !== "json") {
      throw SidjuaError.from("INPUT-003", "format must be csv or json");
    }

    const filters  = parseCtxFilters(c);
    const dateStr  = new Date().toISOString().slice(0, 10);
    const filename = `sidjua-audit-${dateStr}.${fmt}`;

    if (fmt === "csv") {
      const csv = await svc.exportCsv(filters);
      return new Response(csv, {
        headers: {
          "Content-Type":        "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const data = await svc.exportJson(filters);
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    return c.json(data);
  });
}
