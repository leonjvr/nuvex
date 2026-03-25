// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Audit Service
 *
 * Reads from audit_events (compliance events) and cross-references with the
 * tasks and audit_trail tables to produce compliance reports, violation lists,
 * agent trust scores, and summary metrics.
 *
 * Always works on a fresh installation (zero events → empty/default results).
 */

import { randomUUID } from "node:crypto";
import type Database  from "better-sqlite3";
import { hasTable }   from "../db/helpers.js";
import { createLogger } from "../logger.js";
import { runAuditMigrations } from "./audit-migrations.js";
import { assertSafeColumn } from "../../utils/sql-utils.js";

const logger = createLogger("audit-service");


export interface AuditFilters {
  division?:    string;
  agentId?:     string;
  since?:       string;   // ISO date string
  until?:       string;   // ISO date string
  severity?:    "low" | "medium" | "high" | "critical";
  policyType?:  string;
  limit?:       number;
  offset?:      number;
}

export interface AuditRuleEntry {
  ruleId:        string;
  ruleName:      string;
  division:      string;
  enforcedCount: number;
  lastEnforced:  string;
}

export interface AuditReport {
  generatedAt:     string;
  period:          { from: string; to: string };
  totalEvents:     number;
  rulesEnforced:   AuditRuleEntry[];
  complianceScore: number;   // 0-100
  summary:         string;
}

export interface AuditViolation {
  id:        string;
  timestamp: string;
  agentId:   string;
  division:  string;
  action:    "blocked" | "escalated";
  reason:    string;
  severity:  "low" | "medium" | "high" | "critical";
  ruleId:    string;
  taskId?:   string;
}

export interface AgentTrustRecord {
  agentId:          string;
  division:         string;
  totalTasks:       number;
  successfulTasks:  number;
  failedTasks:      number;
  violations:       number;
  trustScore:       number;   // 0-100
  trend:            "improving" | "stable" | "declining";
  periodStart:      string;
  periodEnd:        string;
}

export interface AuditSummary {
  period:              { from: string; to: string };
  totalAgents:         number;
  totalDivisions:      number;
  totalTasks:          number;
  totalViolations:     number;
  complianceRate:      number;
  topViolationTypes:   Array<{ rule: string; count: number }>;
  divisionBreakdown:   Array<{ division: string; complianceRate: number; violations: number }>;
}

// Internal row shapes
interface AuditEventRow {
  id:         string;
  timestamp:  string;
  agent_id:   string;
  division:   string;
  event_type: string;
  rule_id:    string;
  action:     string;
  severity:   string;
  details:    string;
  task_id:    string | null;
}

interface CountRow    { count: number; }
interface AuditTrailRow {
  id:           number;
  timestamp:    string;
  agent_id:     string;
  division_code: string | null;
  action_type:  string;
}


/** Default look-back window when no since/until supplied. */
const DEFAULT_DAYS = 30;

function defaultSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - DEFAULT_DAYS);
  return d.toISOString();
}

function defaultUntil(): string {
  return new Date().toISOString();
}

/** Clamp a number to [0, 100]. */
function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Escape SQL wildcard characters in a string intended for use with LIKE.
 * Prevents `%` or `_` in user-supplied values from matching unintended rows.
 * Use with `ESCAPE '\\'` in the SQL query.
 */
export function escapeSqlWildcards(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

/**
 * Permitted table aliases for buildEventWhere.
 * Column names are HARDCODED below (never derived from user input).
 * Alias is optional and only ever set from internal constants — never from
 * request parameters. This whitelist prevents accidental future misuse.
 */
const ALLOWED_TABLE_ALIASES = new Set(["ae", "at", ""]);

/**
 * Build WHERE clause fragments from AuditFilters for the audit_events table.
 * Returns { clauses, params } ready for .prepare(...).all(...params).
 *
 * Security guarantees:
 *   - Column names are hardcoded literals — never derived from user input.
 *   - All filter values use `?` placeholders (parameterized — no injection).
 *   - tableAlias is validated against ALLOWED_TABLE_ALIASES.
 */
function buildEventWhere(
  filters: AuditFilters,
  opts: { tableAlias?: string } = {},
): { clauses: string[]; params: unknown[] } {
  const rawAlias = opts.tableAlias ?? "";
  assertSafeColumn(rawAlias, ALLOWED_TABLE_ALIASES);
  const alias = rawAlias ? `${rawAlias}.` : "";

  const clauses: string[]  = [];
  const params:  unknown[] = [];

  const since = filters.since ?? defaultSince();
  const until = filters.until ?? defaultUntil();

  // Column names below are HARDCODED — never user-controlled.
  clauses.push(`${alias}timestamp >= ?`);  params.push(since);
  clauses.push(`${alias}timestamp <= ?`);  params.push(until);

  if (filters.division)   { clauses.push(`${alias}division = ?`);    params.push(filters.division);   }
  if (filters.agentId)    { clauses.push(`${alias}agent_id = ?`);    params.push(filters.agentId);    }
  if (filters.severity)   { clauses.push(`${alias}severity = ?`);    params.push(filters.severity);   }
  if (filters.policyType) { clauses.push(`${alias}event_type = ?`);  params.push(filters.policyType); }

  return { clauses, params };
}


export class AuditService {
  constructor(private readonly db: InstanceType<typeof Database>) {}

  // --------------------------------------------------------------------------
  // generateReport
  // --------------------------------------------------------------------------

  async generateReport(filters: AuditFilters): Promise<AuditReport> {
    this._ensureSchema();
    const since = filters.since ?? defaultSince();
    const until = filters.until ?? defaultUntil();

    const { clauses, params } = buildEventWhere(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    // Total events in period
    const totalRow = this.db
      .prepare<unknown[], CountRow>(`SELECT COUNT(*) AS count FROM audit_events ${where}`)
      .get(...params);
    const totalEvents = totalRow?.count ?? 0;

    // Blocked + escalated count (violations)
    const { clauses: vc, params: vp } = buildEventWhere(filters);
    vc.push("action IN ('blocked', 'escalated')");
    const vWhere = `WHERE ${vc.join(" AND ")}`;
    const violationRow = this.db
      .prepare<unknown[], CountRow>(`SELECT COUNT(*) AS count FROM audit_events ${vWhere}`)
      .get(...vp);
    const violations = violationRow?.count ?? 0;

    // Rules enforced — aggregate by rule_id
    const { clauses: rc, params: rp } = buildEventWhere(filters);
    const rWhere = rc.length > 0 ? `WHERE ${rc.join(" AND ")} AND rule_id != ''` : "WHERE rule_id != ''";
    const ruleRows = this.db
      .prepare<unknown[], { rule_id: string; division: string; count: number; last_enforced: string }>(
        `SELECT rule_id, division, COUNT(*) AS count, MAX(timestamp) AS last_enforced
         FROM audit_events ${rWhere}
         GROUP BY rule_id, division
         ORDER BY count DESC`,
      )
      .all(...rp);

    const rulesEnforced: AuditRuleEntry[] = ruleRows.map((r) => ({
      ruleId:        r.rule_id,
      ruleName:      r.rule_id,   // V1: rule_id is the canonical name
      division:      r.division,
      enforcedCount: r.count,
      lastEnforced:  r.last_enforced,
    }));

    // Also pull from audit_trail (existing Phase 11b data) for richer totals
    let auditTrailTotal = 0;
    let auditTrailViolations = 0;
    if (hasTable(this.db, "audit_trail")) {
      const atRow = this.db
        .prepare<unknown[], CountRow>(
          "SELECT COUNT(*) AS count FROM audit_trail WHERE timestamp >= ? AND timestamp <= ?",
        )
        .get(since, until);
      auditTrailTotal = atRow?.count ?? 0;

      const atVRow = this.db
        .prepare<unknown[], CountRow>(
          "SELECT COUNT(*) AS count FROM audit_trail WHERE timestamp >= ? AND timestamp <= ? AND action_type IN ('blocked', 'POLICY_VIOLATION', 'FORBIDDEN')",
        )
        .get(since, until);
      auditTrailViolations = atVRow?.count ?? 0;
    }

    const grandTotal      = totalEvents + auditTrailTotal;
    const grandViolations = violations  + auditTrailViolations;

    const complianceScore = grandTotal > 0
      ? clamp100(Math.round(((grandTotal - grandViolations) / grandTotal) * 100))
      : 100;

    const summary = grandTotal === 0
      ? "No audit events found for the specified period."
      : `${grandTotal} events processed. ${grandViolations} violation(s) detected. Compliance: ${complianceScore}%.`;

    logger.info("audit-service", "generateReport complete", {
      metadata: { totalEvents: grandTotal, complianceScore },
    });

    return {
      generatedAt:     new Date().toISOString(),
      period:          { from: since, to: until },
      totalEvents:     grandTotal,
      rulesEnforced,
      complianceScore,
      summary,
    };
  }

  // --------------------------------------------------------------------------
  // getViolations
  // --------------------------------------------------------------------------

  async getViolations(filters: AuditFilters): Promise<AuditViolation[]> {
    this._ensureSchema();

    const { clauses, params } = buildEventWhere(filters);
    clauses.push("action IN ('blocked', 'escalated')");
    const where = `WHERE ${clauses.join(" AND ")}`;

    const limit  = filters.limit  ?? 50;
    const offset = filters.offset ?? 0;

    const rows = this.db
      .prepare<unknown[], AuditEventRow>(
        `SELECT * FROM audit_events ${where}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return rows.map((r) => {
      let reason = "";
      try {
        const d = JSON.parse(r.details) as Record<string, unknown>;
        reason = typeof d["reason"] === "string" ? d["reason"] : r.event_type;
      } catch (e: unknown) { logger.debug("audit-service", "Audit event details JSON parse failed — using event type as reason", { metadata: { error: e instanceof Error ? e.message : String(e), eventType: r.event_type } }); reason = r.event_type; }

      return {
        id:        r.id,
        timestamp: r.timestamp,
        agentId:   r.agent_id,
        division:  r.division,
        action:    r.action as "blocked" | "escalated",
        reason,
        severity:  r.severity as AuditViolation["severity"],
        ruleId:    r.rule_id,
        ...(r.task_id !== null ? { taskId: r.task_id } : {}),
      };
    });
  }

  // --------------------------------------------------------------------------
  // getAgentTrust
  // --------------------------------------------------------------------------

  /** Maximum number of agents returned by getAgentTrust (safety limit). */
  static readonly MAX_AGENTS = 500;

  async getAgentTrust(filters: AuditFilters): Promise<AgentTrustRecord[]> {
    this._ensureSchema();

    const since = filters.since ?? defaultSince();
    const until = filters.until ?? defaultUntil();

    // Pre-compute previous period dates once (used for trend — avoids per-agent N queries)
    const sinceMs = new Date(since).getTime();
    const untilMs = new Date(until).getTime();
    const span    = untilMs - sinceMs;
    const prevUntil = new Date(sinceMs).toISOString();
    const prevSince = new Date(sinceMs - span).toISOString();

    // 1 query: agent list (capped at MAX_AGENTS for safety)
    const agentRows = this._getAgentList(filters, since, until)
      .slice(0, AuditService.MAX_AGENTS);

    // 1 query: all task counts for current period (batch)
    const taskCountsByAgent = this._getBatchTaskCounts(since, until);

    // 1 query: all violation counts for current period (batch)
    const violationsByAgent = this._getBatchViolationCounts(since, until);

    // 1 query: all task counts for previous period (batch — replaces N×_getTaskCounts calls)
    const prevTaskCountsByAgent = this._getBatchTaskCounts(prevSince, prevUntil);

    // 1 query: all violation counts for previous period (batch — replaces N×_getViolationCount calls)
    const prevViolationsByAgent = this._getBatchViolationCounts(prevSince, prevUntil);

    // Total: 5 queries regardless of agent count (was N×4 before)

    const records: AgentTrustRecord[] = [];

    for (const { agent_id, division } of agentRows) {
      if (filters.agentId && agent_id !== filters.agentId) continue;
      if (filters.division && division !== filters.division) continue;

      const counts     = taskCountsByAgent.get(agent_id) ?? { total: 0, successful: 0, failed: 0 };
      const violations = violationsByAgent.get(agent_id) ?? 0;

      const trustScore = counts.total > 0
        ? clamp100(Math.round((counts.successful / counts.total) * 100 - violations * 5))
        : 100;

      // Compute trend from pre-fetched batch data (no individual queries)
      const prevCounts     = prevTaskCountsByAgent.get(agent_id) ?? { total: 0, successful: 0, failed: 0 };
      const prevViolations = prevViolationsByAgent.get(agent_id) ?? 0;
      const prevScore      = prevCounts.total > 0
        ? clamp100(Math.round((prevCounts.successful / prevCounts.total) * 100 - prevViolations * 5))
        : 100;
      const delta = trustScore - prevScore;
      const trend: AgentTrustRecord["trend"] =
        delta > 5 ? "improving" : delta < -5 ? "declining" : "stable";

      records.push({
        agentId:         agent_id,
        division,
        totalTasks:      counts.total,
        successfulTasks: counts.successful,
        failedTasks:     counts.failed,
        violations,
        trustScore,
        trend,
        periodStart:     since,
        periodEnd:       until,
      });
    }

    return records;
  }

  // --------------------------------------------------------------------------
  // getSummary
  // --------------------------------------------------------------------------

  async getSummary(filters: AuditFilters): Promise<AuditSummary> {
    this._ensureSchema();

    const since = filters.since ?? defaultSince();
    const until = filters.until ?? defaultUntil();

    // Count agents and divisions from audit_events
    const agentCountRow = this.db
      .prepare<unknown[], CountRow>(
        "SELECT COUNT(DISTINCT agent_id) AS count FROM audit_events WHERE timestamp >= ? AND timestamp <= ?",
      )
      .get(since, until);

    const divCountRow = this.db
      .prepare<unknown[], CountRow>(
        "SELECT COUNT(DISTINCT division) AS count FROM audit_events WHERE timestamp >= ? AND timestamp <= ? AND division != ''",
      )
      .get(since, until);

    // Task count from tasks table
    let totalTasks = 0;
    if (hasTable(this.db, "tasks")) {
      const taskRow = this.db
        .prepare<unknown[], CountRow>(
          "SELECT COUNT(*) AS count FROM tasks WHERE created_at >= ? AND created_at <= ?",
        )
        .get(since, until);
      totalTasks = taskRow?.count ?? 0;
    }

    // Violations
    const violationRow = this.db
      .prepare<unknown[], CountRow>(
        "SELECT COUNT(*) AS count FROM audit_events WHERE timestamp >= ? AND timestamp <= ? AND action IN ('blocked', 'escalated')",
      )
      .get(since, until);
    const totalViolations = violationRow?.count ?? 0;

    // Total events
    const totalRow = this.db
      .prepare<unknown[], CountRow>(
        "SELECT COUNT(*) AS count FROM audit_events WHERE timestamp >= ? AND timestamp <= ?",
      )
      .get(since, until);
    const totalEvents = totalRow?.count ?? 0;

    const complianceRate = totalEvents > 0
      ? clamp100(Math.round(((totalEvents - totalViolations) / totalEvents) * 100))
      : 100;

    // Top violation types by rule_id
    const topViolRows = this.db
      .prepare<unknown[], { rule_id: string; count: number }>(
        `SELECT rule_id, COUNT(*) AS count FROM audit_events
         WHERE timestamp >= ? AND timestamp <= ? AND action IN ('blocked', 'escalated')
         GROUP BY rule_id ORDER BY count DESC LIMIT 5`,
      )
      .all(since, until);

    // Division breakdown
    const divRows = this.db
      .prepare<unknown[], { division: string; total: number; violations: number }>(
        `SELECT division,
                COUNT(*) AS total,
                SUM(CASE WHEN action IN ('blocked','escalated') THEN 1 ELSE 0 END) AS violations
         FROM audit_events
         WHERE timestamp >= ? AND timestamp <= ? AND division != ''
         GROUP BY division ORDER BY division`,
      )
      .all(since, until);

    return {
      period:            { from: since, to: until },
      totalAgents:       agentCountRow?.count ?? 0,
      totalDivisions:    divCountRow?.count   ?? 0,
      totalTasks,
      totalViolations,
      complianceRate,
      topViolationTypes: topViolRows.map((r) => ({ rule: r.rule_id, count: r.count })),
      divisionBreakdown: divRows.map((r) => ({
        division:       r.division,
        complianceRate: r.total > 0
          ? clamp100(Math.round(((r.total - r.violations) / r.total) * 100))
          : 100,
        violations:     r.violations,
      })),
    };
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private _ensureSchema(): void {
    runAuditMigrations(this.db);
  }

  private _getAgentList(
    filters: AuditFilters,
    since: string,
    until: string,
  ): Array<{ agent_id: string; division: string }> {
    type AgentRow = { agent_id: string; division: string };

    // Prefer tasks table for richer data
    if (hasTable(this.db, "tasks")) {
      const rows = this.db
        .prepare<unknown[], AgentRow>(
          `SELECT DISTINCT assigned_agent AS agent_id, division
           FROM tasks
           WHERE created_at >= ? AND created_at <= ?
             AND assigned_agent IS NOT NULL
           ORDER BY assigned_agent`,
        )
        .all(since, until);
      if (rows.length > 0) return rows;
    }

    // Fallback: audit_events
    return this.db
      .prepare<unknown[], AgentRow>(
        `SELECT DISTINCT agent_id, division FROM audit_events
         WHERE timestamp >= ? AND timestamp <= ?
         ORDER BY agent_id`,
      )
      .all(since, until);
  }

  private _getTaskCounts(
    agentId: string,
    since: string,
    until: string,
  ): { total: number; successful: number; failed: number } {
    if (!hasTable(this.db, "tasks")) return { total: 0, successful: 0, failed: 0 };

    interface TaskCountRow { total: number; successful: number; failed: number; }
    const row = this.db
      .prepare<unknown[], TaskCountRow>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status IN ('DONE', 'COMPLETED') THEN 1 ELSE 0 END) AS successful,
           SUM(CASE WHEN status IN ('FAILED', 'ESCALATED', 'CANCELLED') THEN 1 ELSE 0 END) AS failed
         FROM tasks
         WHERE assigned_agent = ? AND created_at >= ? AND created_at <= ?`,
      )
      .get(agentId, since, until);

    return {
      total:      row?.total      ?? 0,
      successful: row?.successful ?? 0,
      failed:     row?.failed     ?? 0,
    };
  }

  private _getViolationCount(agentId: string, since: string, until: string): number {
    const row = this.db
      .prepare<unknown[], CountRow>(
        "SELECT COUNT(*) AS count FROM audit_events WHERE agent_id = ? AND timestamp >= ? AND timestamp <= ? AND action IN ('blocked', 'escalated')",
      )
      .get(agentId, since, until);
    return row?.count ?? 0;
  }

  private _getBatchTaskCounts(
    since: string,
    until: string,
  ): Map<string, { total: number; successful: number; failed: number }> {
    if (!hasTable(this.db, "tasks")) return new Map();

    interface BatchTaskRow {
      agent_id:   string;
      total:      number;
      successful: number;
      failed:     number;
    }

    const rows = this.db
      .prepare<unknown[], BatchTaskRow>(
        `SELECT assigned_agent AS agent_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('DONE', 'COMPLETED') THEN 1 ELSE 0 END) AS successful,
                SUM(CASE WHEN status IN ('FAILED', 'ESCALATED', 'CANCELLED') THEN 1 ELSE 0 END) AS failed
         FROM tasks
         WHERE created_at >= ? AND created_at <= ? AND assigned_agent IS NOT NULL
         GROUP BY assigned_agent`,
      )
      .all(since, until);

    return new Map(
      rows.map((r) => [r.agent_id, { total: r.total, successful: r.successful, failed: r.failed }]),
    );
  }

  private _getBatchViolationCounts(
    since: string,
    until: string,
  ): Map<string, number> {
    const rows = this.db
      .prepare<unknown[], { agent_id: string; count: number }>(
        `SELECT agent_id, COUNT(*) AS count
         FROM audit_events
         WHERE timestamp >= ? AND timestamp <= ? AND action IN ('blocked', 'escalated')
         GROUP BY agent_id`,
      )
      .all(since, until);

    return new Map(rows.map((r) => [r.agent_id, r.count]));
  }

  private _computeTrend(
    agentId: string,
    since: string,
    until: string,
  ): "improving" | "stable" | "declining" {
    // Compare current period score to the previous same-length period
    const sinceMs = new Date(since).getTime();
    const untilMs = new Date(until).getTime();
    const span    = untilMs - sinceMs;

    const prevUntil = new Date(sinceMs).toISOString();
    const prevSince = new Date(sinceMs - span).toISOString();

    const currentScore = this._periodTrustScore(agentId, since, until);
    const prevScore    = this._periodTrustScore(agentId, prevSince, prevUntil);

    const delta = currentScore - prevScore;
    if (delta > 5)  return "improving";
    if (delta < -5) return "declining";
    return "stable";
  }

  private _periodTrustScore(agentId: string, since: string, until: string): number {
    const { total, successful } = this._getTaskCounts(agentId, since, until);
    const violations = this._getViolationCount(agentId, since, until);
    if (total === 0) return 100;
    return clamp100(Math.round((successful / total) * 100 - violations * 5));
  }

  // --------------------------------------------------------------------------
  // Export helpers (used by CLI and API)
  // --------------------------------------------------------------------------

  async exportJson(filters: AuditFilters): Promise<unknown> {
    const [report, violations, agents, summary] = await Promise.all([
      this.generateReport(filters),
      this.getViolations({ ...filters, limit: 10_000 }),
      this.getAgentTrust(filters),
      this.getSummary(filters),
    ]);
    return { report, violations, agents, summary };
  }

  async exportCsv(filters: AuditFilters): Promise<string> {
    const violations = await this.getViolations({ ...filters, limit: 10_000 });
    const agents     = await this.getAgentTrust(filters);

    const lines: string[] = [];

    lines.push("=== Violations ===");
    lines.push("id,timestamp,agentId,division,action,severity,ruleId,reason");
    for (const v of violations) {
      lines.push([
        v.id, v.timestamp, v.agentId, v.division, v.action,
        v.severity, v.ruleId, `"${(v.reason ?? "").replace(/"/g, '""')}"`,
      ].join(","));
    }

    lines.push("");
    lines.push("=== Agent Trust Scores ===");
    lines.push("agentId,division,totalTasks,successfulTasks,failedTasks,violations,trustScore,trend");
    for (const a of agents) {
      lines.push([
        a.agentId, a.division, a.totalTasks, a.successfulTasks,
        a.failedTasks, a.violations, a.trustScore, a.trend,
      ].join(","));
    }

    return lines.join("\n");
  }

  // --------------------------------------------------------------------------
  // Violation count helper for API (total without limit)
  // --------------------------------------------------------------------------

  getViolationCount(filters: AuditFilters): number {
    this._ensureSchema();
    const { clauses, params } = buildEventWhere(filters);
    clauses.push("action IN ('blocked', 'escalated')");
    const where = `WHERE ${clauses.join(" AND ")}`;
    const row = this.db
      .prepare<unknown[], CountRow>(`SELECT COUNT(*) AS count FROM audit_events ${where}`)
      .get(...params);
    return row?.count ?? 0;
  }
}
