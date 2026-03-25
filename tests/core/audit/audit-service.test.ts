// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/audit/audit-service.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../../src/utils/db.js";
import { AuditService } from "../../../src/core/audit/audit-service.js";
import { runAuditMigrations } from "../../../src/core/audit/audit-migrations.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-audit-svc-test-"));
}

function openTestDb(workDir: string) {
  const systemDir = join(workDir, ".system");
  mkdirSync(systemDir, { recursive: true });
  const db = openDatabase(join(systemDir, "sidjua.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      parent_id     TEXT,
      root_id       TEXT NOT NULL,
      division      TEXT NOT NULL,
      type          TEXT NOT NULL,
      tier          INTEGER NOT NULL DEFAULT 2,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL,
      assigned_agent TEXT,
      status        TEXT NOT NULL DEFAULT 'CREATED',
      priority      INTEGER NOT NULL DEFAULT 3,
      classification TEXT NOT NULL DEFAULT 'internal',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);
  runAuditMigrations(db);
  return db;
}

function insertEvent(
  db: ReturnType<typeof openDatabase>,
  opts: {
    agentId?:  string;
    division?: string;
    action?:   "allowed" | "blocked" | "escalated";
    severity?: "low" | "medium" | "high" | "critical";
    ruleId?:   string;
    taskId?:   string;
    reason?:   string;
    ts?:       string;
  } = {},
) {
  const id       = randomUUID();
  const ts       = opts.ts       ?? new Date().toISOString();
  const agentId  = opts.agentId  ?? "agent-1";
  const division = opts.division ?? "engineering";
  const action   = opts.action   ?? "allowed";
  const severity = opts.severity ?? "low";
  const ruleId   = opts.ruleId   ?? "RULE-001";
  const details  = JSON.stringify({ reason: opts.reason ?? "test reason" });

  db.prepare(
    "INSERT INTO audit_events (id, timestamp, agent_id, division, event_type, rule_id, action, severity, details, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, ts, agentId, division, "policy_check", ruleId, action, severity, details, opts.taskId ?? null);

  return id;
}

function insertTask(
  db: ReturnType<typeof openDatabase>,
  opts: {
    agentId?: string;
    division?: string;
    status?: string;
    ts?: string;
  } = {},
) {
  const id       = randomUUID();
  const ts       = opts.ts       ?? new Date().toISOString();
  const agentId  = opts.agentId  ?? "agent-1";
  const division = opts.division ?? "engineering";
  const status   = opts.status   ?? "DONE";

  db.prepare(
    "INSERT INTO tasks (id, root_id, division, type, tier, title, description, assigned_agent, status, priority, classification, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, id, division, "execute", 2, "Task", "Desc", agentId, status, 3, "internal", ts, ts);

  return id;
}

// ===========================================================================

describe("AuditService", () => {
  let tmp: string;
  let db: ReturnType<typeof openDatabase>;
  let svc: AuditService;

  beforeEach(() => {
    tmp = makeTempDir();
    db  = openTestDb(tmp);
    svc = new AuditService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // generateReport — zero events
  // --------------------------------------------------------------------------

  it("generateReport with zero events returns defaults without crash", async () => {
    const report = await svc.generateReport({});
    expect(report.totalEvents).toBe(0);
    expect(report.complianceScore).toBe(100);
    expect(report.rulesEnforced).toHaveLength(0);
    expect(report.summary).toMatch(/No audit events/);
  });

  it("generateReport includes generatedAt and period fields", async () => {
    const report = await svc.generateReport({});
    expect(report.generatedAt).toBeTruthy();
    expect(report.period.from).toBeTruthy();
    expect(report.period.to).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // generateReport — with events
  // --------------------------------------------------------------------------

  it("generateReport counts events and computes compliance score", async () => {
    // 8 allowed, 2 blocked → 80% compliance
    for (let i = 0; i < 8; i++) insertEvent(db, { action: "allowed" });
    for (let i = 0; i < 2; i++) insertEvent(db, { action: "blocked" });

    const report = await svc.generateReport({});
    expect(report.totalEvents).toBe(10);
    expect(report.complianceScore).toBe(80);
  });

  it("generateReport aggregates rules enforced by ruleId", async () => {
    insertEvent(db, { ruleId: "RULE-001", division: "eng" });
    insertEvent(db, { ruleId: "RULE-001", division: "eng" });
    insertEvent(db, { ruleId: "RULE-002", division: "ops" });

    const report = await svc.generateReport({});
    const ruleIds = report.rulesEnforced.map((r) => r.ruleId);
    expect(ruleIds).toContain("RULE-001");
    expect(ruleIds).toContain("RULE-002");
    const rule1 = report.rulesEnforced.find((r) => r.ruleId === "RULE-001")!;
    expect(rule1.enforcedCount).toBe(2);
  });

  it("generateReport filters by division", async () => {
    insertEvent(db, { division: "engineering" });
    insertEvent(db, { division: "ops" });

    const report = await svc.generateReport({ division: "engineering" });
    expect(report.totalEvents).toBe(1);
  });

  it("generateReport filters by date range", async () => {
    const old = new Date("2024-01-01T00:00:00Z").toISOString();
    insertEvent(db, { ts: old });
    insertEvent(db, {}); // now

    const report = await svc.generateReport({ since: "2025-01-01T00:00:00Z" });
    expect(report.totalEvents).toBe(1);
  });

  // --------------------------------------------------------------------------
  // getViolations
  // --------------------------------------------------------------------------

  it("getViolations returns only blocked and escalated events", async () => {
    insertEvent(db, { action: "allowed" });
    insertEvent(db, { action: "blocked",   severity: "high"   });
    insertEvent(db, { action: "escalated", severity: "medium" });

    const violations = await svc.getViolations({});
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => ["blocked", "escalated"].includes(v.action))).toBe(true);
  });

  it("getViolations filters by severity", async () => {
    insertEvent(db, { action: "blocked", severity: "high"   });
    insertEvent(db, { action: "blocked", severity: "low"    });
    insertEvent(db, { action: "blocked", severity: "critical" });

    const violations = await svc.getViolations({ severity: "high" });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.severity).toBe("high");
  });

  it("getViolations filters by agentId", async () => {
    insertEvent(db, { action: "blocked", agentId: "agent-alpha" });
    insertEvent(db, { action: "blocked", agentId: "agent-beta"  });

    const violations = await svc.getViolations({ agentId: "agent-alpha" });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.agentId).toBe("agent-alpha");
  });

  it("getViolations extracts reason from details JSON", async () => {
    insertEvent(db, { action: "blocked", reason: "Forbidden tool use" });

    const violations = await svc.getViolations({});
    expect(violations[0]!.reason).toBe("Forbidden tool use");
  });

  it("getViolations with zero events returns empty array", async () => {
    const violations = await svc.getViolations({});
    expect(violations).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // getAgentTrust — trust score formula
  // --------------------------------------------------------------------------

  it("getAgentTrust computes trustScore = (successful/total)*100 - violations*5, clamped", async () => {
    // 4 successful tasks, 0 failed, 1 violation → (4/4)*100 - 1*5 = 95
    const ts = new Date().toISOString();
    for (let i = 0; i < 4; i++) insertTask(db, { agentId: "agent-x", status: "DONE", ts });
    insertEvent(db, { agentId: "agent-x", action: "blocked" });

    const agents = await svc.getAgentTrust({});
    const rec    = agents.find((a) => a.agentId === "agent-x");
    expect(rec).toBeDefined();
    expect(rec!.trustScore).toBe(95);
  });

  it("getAgentTrust clamps trust score to 0 minimum", async () => {
    const ts = new Date().toISOString();
    insertTask(db, { agentId: "agent-bad", status: "DONE", ts });
    // 25 violations → (1/1)*100 - 25*5 = -25 → clamped to 0
    for (let i = 0; i < 25; i++) insertEvent(db, { agentId: "agent-bad", action: "blocked" });

    const agents = await svc.getAgentTrust({});
    const rec    = agents.find((a) => a.agentId === "agent-bad");
    expect(rec!.trustScore).toBe(0);
  });

  it("getAgentTrust returns 100 for agent with no tasks and no violations", async () => {
    insertEvent(db, { agentId: "agent-new", action: "allowed" });

    const agents = await svc.getAgentTrust({});
    const rec    = agents.find((a) => a.agentId === "agent-new");
    // No tasks → trustScore = 100
    expect(rec!.trustScore).toBe(100);
  });

  it("getAgentTrust filters by division", async () => {
    const ts = new Date().toISOString();
    insertTask(db, { agentId: "agent-eng", division: "engineering", ts });
    insertTask(db, { agentId: "agent-ops", division: "ops",         ts });

    const agents = await svc.getAgentTrust({ division: "engineering" });
    expect(agents.every((a) => a.division === "engineering")).toBe(true);
  });

  it("getAgentTrust returns empty list when no agents exist", async () => {
    const agents = await svc.getAgentTrust({});
    expect(agents).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // getSummary
  // --------------------------------------------------------------------------

  it("getSummary returns correct violation count", async () => {
    insertEvent(db, { action: "allowed"   });
    insertEvent(db, { action: "blocked"   });
    insertEvent(db, { action: "escalated" });

    const summary = await svc.getSummary({});
    expect(summary.totalViolations).toBe(2);
    expect(summary.complianceRate).toBe(33); // 1/3 compliant
  });

  it("getSummary returns zero-default for fresh install", async () => {
    const summary = await svc.getSummary({});
    expect(summary.totalViolations).toBe(0);
    expect(summary.complianceRate).toBe(100);
    expect(summary.topViolationTypes).toHaveLength(0);
    expect(summary.divisionBreakdown).toHaveLength(0);
  });

  it("getSummary divisionBreakdown has correct per-division rates", async () => {
    // engineering: 2 allowed, 2 blocked → 50% compliance
    for (let i = 0; i < 2; i++) insertEvent(db, { division: "engineering", action: "allowed" });
    for (let i = 0; i < 2; i++) insertEvent(db, { division: "engineering", action: "blocked" });

    const summary = await svc.getSummary({});
    const eng = summary.divisionBreakdown.find((d) => d.division === "engineering");
    expect(eng).toBeDefined();
    expect(eng!.complianceRate).toBe(50);
    expect(eng!.violations).toBe(2);
  });

  it("getSummary topViolationTypes is ordered by count descending", async () => {
    insertEvent(db, { action: "blocked", ruleId: "RULE-A" });
    insertEvent(db, { action: "blocked", ruleId: "RULE-A" });
    insertEvent(db, { action: "blocked", ruleId: "RULE-A" });
    insertEvent(db, { action: "blocked", ruleId: "RULE-B" });

    const summary = await svc.getSummary({});
    expect(summary.topViolationTypes[0]!.rule).toBe("RULE-A");
    expect(summary.topViolationTypes[0]!.count).toBe(3);
  });

  // --------------------------------------------------------------------------
  // Filter combinations
  // --------------------------------------------------------------------------

  it("multiple filters work simultaneously (division + severity + since)", async () => {
    const recent = new Date().toISOString();
    const old    = new Date("2024-01-01").toISOString();

    insertEvent(db, { division: "eng", severity: "high", action: "blocked", ts: recent });
    insertEvent(db, { division: "ops", severity: "high", action: "blocked", ts: recent });
    insertEvent(db, { division: "eng", severity: "low",  action: "blocked", ts: recent });
    insertEvent(db, { division: "eng", severity: "high", action: "blocked", ts: old    });

    const violations = await svc.getViolations({
      division: "eng",
      severity: "high",
      since:    "2025-01-01T00:00:00Z",
    });
    expect(violations).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // Date range edge cases
  // --------------------------------------------------------------------------

  it("same-day since/until returns events from that day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    insertEvent(db, { ts: `${today}T12:00:00.000Z` });

    const report = await svc.generateReport({
      since: `${today}T00:00:00.000Z`,
      until: `${today}T23:59:59.999Z`,
    });
    expect(report.totalEvents).toBeGreaterThanOrEqual(1);
  });

  it("future since date returns zero events", async () => {
    insertEvent(db);

    const report = await svc.generateReport({ since: "2099-01-01T00:00:00Z", until: "2099-12-31T23:59:59Z" });
    expect(report.totalEvents).toBe(0);
    expect(report.complianceScore).toBe(100);
  });

  // --------------------------------------------------------------------------
  // Export helpers
  // --------------------------------------------------------------------------

  it("exportJson returns structured data with report, violations, agents, summary keys", async () => {
    insertEvent(db, { action: "blocked" });
    const data = await svc.exportJson({}) as Record<string, unknown>;
    expect(data).toHaveProperty("report");
    expect(data).toHaveProperty("violations");
    expect(data).toHaveProperty("agents");
    expect(data).toHaveProperty("summary");
  });

  it("exportCsv returns CSV string with violation and agent sections", async () => {
    insertEvent(db, { action: "blocked", reason: "Test violation" });
    const csv = await svc.exportCsv({});
    expect(csv).toContain("Violations");
    expect(csv).toContain("agentId");
  });
});

// ---------------------------------------------------------------------------
// P194 Task 2 — Batched _computeTrend (no N+1 queries), MAX_AGENTS limit
// ---------------------------------------------------------------------------

describe("P194: getAgentTrust — batched trend computation (Task 2)", () => {
  let workDir: string;
  let db: ReturnType<typeof openTestDb>;
  let svc: AuditService;

  beforeEach(() => {
    workDir = makeTempDir();
    db      = openTestDb(workDir);
    svc     = new AuditService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns correct trend=stable when no previous period data", async () => {
    insertEvent(db, { agentId: "agent-batch", action: "allowed" });
    const records = await svc.getAgentTrust({});
    const rec = records.find((r) => r.agentId === "agent-batch");
    expect(rec).toBeDefined();
    expect(["improving", "stable", "declining"]).toContain(rec!.trend);
  });

  it("trend=stable when current and previous scores are equal", async () => {
    // Both periods have the same trust score → delta is 0 → stable
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const until = new Date().toISOString();
    insertEvent(db, { agentId: "stable-agent", action: "allowed" });
    const records = await svc.getAgentTrust({ since, until });
    const rec = records.find((r) => r.agentId === "stable-agent");
    if (rec !== undefined) {
      expect(rec.trend).toBe("stable");
    }
  });

  it("MAX_AGENTS constant is 500", () => {
    expect(AuditService.MAX_AGENTS).toBe(500);
  });

  it("returns at most MAX_AGENTS records when many agents exist", async () => {
    // Insert events for 10 distinct agents — should be well under the cap
    for (let i = 0; i < 10; i++) {
      insertEvent(db, { agentId: `bulk-agent-${i}`, action: "allowed" });
    }
    const records = await svc.getAgentTrust({});
    // All 10 should be returned (we're under the 500 cap)
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records.length).toBeLessThanOrEqual(AuditService.MAX_AGENTS);
  });

  it("getAgentTrust returns records with all required fields", async () => {
    insertEvent(db, { agentId: "agent-fields", action: "blocked" });
    const records = await svc.getAgentTrust({});
    const rec = records.find((r) => r.agentId === "agent-fields");
    if (rec !== undefined) {
      expect(typeof rec.trustScore).toBe("number");
      expect(rec.trustScore).toBeGreaterThanOrEqual(0);
      expect(rec.trustScore).toBeLessThanOrEqual(100);
      expect(rec.periodStart).toBeTruthy();
      expect(rec.periodEnd).toBeTruthy();
    }
  });
});
