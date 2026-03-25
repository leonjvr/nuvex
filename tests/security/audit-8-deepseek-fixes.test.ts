/**
 * SIDJUA — DeepSeek Audit fixes (2026-03-14)
 *
 * Fix 1: resolveSkillPath symlink traversal (MEDIUM)
 * Fix 2: WAL getWALSince unbounded query (MEDIUM)
 * Fix 3: Budget check + spend atomicity (MEDIUM)
 */

import { describe, it, expect, afterEach } from "vitest";
import { symlinkSync, mkdtempSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Fix 1 — resolveSkillPath: symlink traversal protection
// ---------------------------------------------------------------------------

import { resolveSkillPath } from "../../src/agent-lifecycle/agent-template.js";

describe("Fix 1: resolveSkillPath — symlink traversal protection", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    // Clean up temp dirs created during tests
    for (const dir of createdDirs.reverse()) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    createdDirs.length = 0;
  });

  it("rejects a symlink pointing outside workDir (SEC-010)", () => {
    const workDir    = mkdtempSync(join(tmpdir(), "sidjua-wdir-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "sidjua-outside-"));
    createdDirs.push(workDir, outsideDir);

    // Create a file outside workDir and a symlink inside workDir pointing to it
    const outsideFile = join(outsideDir, "secret.md");
    writeFileSync(outsideFile, "secret content");
    const symlinkPath = join(workDir, "evil-link.md");
    symlinkSync(outsideFile, symlinkPath);

    expect(() => resolveSkillPath(workDir, "evil-link.md")).toThrow(/symlink|SEC-010|path traversal/i);
  });

  it("allows a valid symlink pointing within workDir", () => {
    const workDir = mkdtempSync(join(tmpdir(), "sidjua-wdir-"));
    createdDirs.push(workDir);

    // Create a real file and a symlink both inside workDir
    const realFile = join(workDir, "real-skill.md");
    writeFileSync(realFile, "# Skill");
    const symlinkPath = join(workDir, "link-skill.md");
    symlinkSync(realFile, symlinkPath);

    const result = resolveSkillPath(workDir, "link-skill.md");
    // result should be the realpath of the real file (symlink resolved)
    expect(result).toContain("real-skill.md");
  });

  it("returns resolved path for non-existent skill (ENOENT — new skill creation)", () => {
    const workDir = mkdtempSync(join(tmpdir(), "sidjua-wdir-"));
    createdDirs.push(workDir);

    // Path does not exist yet — should not throw
    const result = resolveSkillPath(workDir, "new-skill.md");
    expect(result).toBe(join(workDir, "new-skill.md"));
  });

  it("still rejects path traversal with ..", () => {
    const workDir = mkdtempSync(join(tmpdir(), "sidjua-wdir-"));
    createdDirs.push(workDir);

    expect(() => resolveSkillPath(workDir, "../../etc/passwd")).toThrow(/path traversal|SEC-010/i);
  });

  it("still rejects absolute skill paths", () => {
    const workDir = mkdtempSync(join(tmpdir(), "sidjua-wdir-"));
    createdDirs.push(workDir);

    expect(() => resolveSkillPath(workDir, "/etc/passwd")).toThrow(/absolute|SEC-010/i);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — WAL getWALSince: LIMIT parameter
// ---------------------------------------------------------------------------

import { WALManager, WAL_QUERY_LIMIT } from "../../src/agent-lifecycle/checkpoint/wal-manager.js";
import type { Database as DbType } from "../../src/utils/db.js";

function makeWalDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE agent_wal (
      sequence   INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id   TEXT NOT NULL,
      timestamp  TEXT NOT NULL,
      operation  TEXT NOT NULL,
      data_json  TEXT NOT NULL,
      checksum   TEXT NOT NULL
    )
  `);
  return db;
}

describe("Fix 2: WALManager.getWALSince — LIMIT parameter", () => {
  it("WAL_QUERY_LIMIT is exported and equals 10,000", () => {
    expect(WAL_QUERY_LIMIT).toBe(10_000);
  });

  it("custom limit is respected (insert 20, query with limit=10, get 10)", () => {
    const db  = makeWalDb();
    const mgr = new WALManager(db as unknown as DbType);

    for (let i = 0; i < 20; i++) {
      mgr.appendWAL({ agent_id: "agent-limit", operation: `op${i}`, data: { i } });
    }

    const entries = mgr.getWALSince("agent-limit", 0, 10);
    expect(entries).toHaveLength(10);
    // Entries should be the first 10 (lowest sequences)
    expect(entries[0].operation).toBe("op0");
    expect(entries[9].operation).toBe("op9");
  });

  it("returns fewer entries than limit when total < limit", () => {
    const db  = makeWalDb();
    const mgr = new WALManager(db as unknown as DbType);

    for (let i = 0; i < 5; i++) {
      mgr.appendWAL({ agent_id: "agent-few", operation: `op${i}`, data: {} });
    }

    const entries = mgr.getWALSince("agent-few", 0, 100);
    expect(entries).toHaveLength(5);
  });

  it("default limit is WAL_QUERY_LIMIT (signature accepts 2 args)", () => {
    const db  = makeWalDb();
    const mgr = new WALManager(db as unknown as DbType);
    mgr.appendWAL({ agent_id: "agent-default", operation: "op", data: {} });

    // Call with only 2 args — should use default limit and not throw
    const entries = mgr.getWALSince("agent-default", 0);
    expect(entries).toHaveLength(1);
  });

  it("pagination: second query from last sequence returns next batch", () => {
    const db  = makeWalDb();
    const mgr = new WALManager(db as unknown as DbType);

    for (let i = 0; i < 15; i++) {
      mgr.appendWAL({ agent_id: "agent-page", operation: `op${i}`, data: {} });
    }

    const page1 = mgr.getWALSince("agent-page", 0, 10);
    expect(page1).toHaveLength(10);
    const lastSeq = page1[page1.length - 1].sequence;

    const page2 = mgr.getWALSince("agent-page", lastSeq, 10);
    expect(page2).toHaveLength(5);
    // Page 2 should start right after page 1
    expect(page2[0].sequence).toBeGreaterThan(lastSeq);
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — Budget atomicity: checkAndSpend
// ---------------------------------------------------------------------------

import { BudgetResolver } from "../../src/agent-lifecycle/budget-resolver.js";

function makeBudgetDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE agent_budgets (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id     TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_type  TEXT NOT NULL,
      spent_usd    REAL NOT NULL DEFAULT 0,
      limit_usd    REAL NOT NULL DEFAULT 0,
      UNIQUE(agent_id, period_start, period_type)
    );
    CREATE TABLE agent_definitions (
      id          TEXT PRIMARY KEY,
      config_yaml TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("Fix 3: BudgetResolver.checkAndSpend — atomic check-and-spend", () => {
  it("checkAndSpend is exported", () => {
    const db = makeBudgetDb();
    const resolver = new BudgetResolver(db as unknown as DbType);
    expect(typeof resolver.checkAndSpend).toBe("function");
  });

  it("returns true and records spend when within budget", () => {
    const db = makeBudgetDb();
    // Register agent with $10/month limit
    db.exec(`INSERT INTO agent_definitions (id, config_yaml) VALUES (
      'agent-a',
      'budget:\n  per_month_usd: 10.0\n  per_task_usd: 5.0'
    )`);
    const period = new Date().toISOString().slice(0, 7) + "-01";
    const resolver = new BudgetResolver(db as unknown as DbType);

    const ok = resolver.checkAndSpend("agent-a", 3.0, period);
    expect(ok).toBe(true);

    // Verify spend was recorded
    const row = db.prepare(
      "SELECT spent_usd FROM agent_budgets WHERE agent_id = ? AND period_type = 'monthly'",
    ).get("agent-a") as { spent_usd: number } | undefined;
    expect(row?.spent_usd).toBeCloseTo(3.0);
  });

  it("returns false and does NOT record spend when budget exceeded", () => {
    const db = makeBudgetDb();
    db.exec(`INSERT INTO agent_definitions (id, config_yaml) VALUES (
      'agent-b',
      'budget:\n  per_month_usd: 5.0\n  per_task_usd: 10.0'
    )`);
    const period = new Date().toISOString().slice(0, 7) + "-01";
    const resolver = new BudgetResolver(db as unknown as DbType);

    // Pre-spend $4 (leaving $1 headroom)
    db.exec(`INSERT INTO agent_budgets (agent_id, period_start, period_type, spent_usd, limit_usd)
             VALUES ('agent-b', '${period}', 'monthly', 4.0, 0)`);

    // Attempt to spend $2 more (would exceed $5 limit)
    const ok = resolver.checkAndSpend("agent-b", 2.0, period);
    expect(ok).toBe(false);

    // Confirm spend was NOT recorded
    const row = db.prepare(
      "SELECT spent_usd FROM agent_budgets WHERE agent_id = ? AND period_type = 'monthly'",
    ).get("agent-b") as { spent_usd: number } | undefined;
    expect(row?.spent_usd).toBeCloseTo(4.0); // unchanged
  });

  it("sequential calls: second call is blocked after first fills the budget", () => {
    const db = makeBudgetDb();
    db.exec(`INSERT INTO agent_definitions (id, config_yaml) VALUES (
      'agent-c',
      'budget:\n  per_month_usd: 5.0\n  per_task_usd: 10.0'
    )`);
    const period = new Date().toISOString().slice(0, 7) + "-01";
    const resolver = new BudgetResolver(db as unknown as DbType);

    // First spend: $3 — should succeed
    const ok1 = resolver.checkAndSpend("agent-c", 3.0, period);
    expect(ok1).toBe(true);

    // Second spend: $3 — should fail (would bring total to $6, over $5 limit)
    const ok2 = resolver.checkAndSpend("agent-c", 3.0, period);
    expect(ok2).toBe(false);

    // Verify only $3 was recorded
    const row = db.prepare(
      "SELECT spent_usd FROM agent_budgets WHERE agent_id = ? AND period_type = 'monthly'",
    ).get("agent-c") as { spent_usd: number } | undefined;
    expect(row?.spent_usd).toBeCloseTo(3.0);
  });

  it("returns false (fail-closed) when agent_budgets table does not exist", () => {
    // DB with no agent_budgets table — simulates pre-apply state
    const db = new Database(":memory:");
    db.exec("CREATE TABLE agent_definitions (id TEXT PRIMARY KEY, config_yaml TEXT NOT NULL, created_at TEXT)");
    db.exec(`INSERT INTO agent_definitions (id, config_yaml) VALUES ('agent-x', 'budget:\n  per_month_usd: 5.0')`);
    const resolver = new BudgetResolver(db as unknown as DbType);

    // Should not throw — fail-closed: missing table → deny spend
    const ok = resolver.checkAndSpend("agent-x", 1.0);
    expect(ok).toBe(false);
  });
});
