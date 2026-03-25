// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SQLite hardening + free tier agent limit tests.
 *
 * Covers:
 *   Task 1: Free tier agent limit (80 warn / 100 hard block)
 *   Task 2: WAL mode + busy_timeout on all database connections
 *   Task 3: WAL checksum two-step wrapped in transaction
 *   Task 4: CLI DB connection closing via try/finally
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir }              from "node:os";
import { join }                from "node:path";
import Database                from "better-sqlite3";

// ---------------------------------------------------------------------------
// Task 1 — Free tier agent limit
// ---------------------------------------------------------------------------

describe("Task 1: AgentRegistry — free tier limit enforcement", () => {
  it("exports FREE_TIER_AGENT_SOFT_LIMIT = 80 and FREE_TIER_AGENT_HARD_LIMIT = 100", async () => {
    const { FREE_TIER_AGENT_SOFT_LIMIT, FREE_TIER_AGENT_HARD_LIMIT } =
      await import("../../src/agent-lifecycle/agent-registry.js");
    expect(FREE_TIER_AGENT_SOFT_LIMIT).toBe(80);
    expect(FREE_TIER_AGENT_HARD_LIMIT).toBe(100);
  });

  it("source contains agent count query before create", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/agent-lifecycle/agent-registry.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("SELECT COUNT(*) AS count FROM agent_definitions WHERE status != 'deleted'");
    expect(src).toContain("FREE_TIER_AGENT_HARD_LIMIT");
    expect(src).toContain("FREE_TIER_AGENT_SOFT_LIMIT");
    expect(src).toContain("LIMIT-001");
  });

  it("LIMIT-001 is registered in the error code registry", async () => {
    const { lookupErrorCode } = await import("../../src/core/error-codes.js");
    const entry = lookupErrorCode("LIMIT-001");
    expect(entry).toBeDefined();
    expect(entry?.recoverable).toBe(false);
  });

  it("creates agent normally when count < 80", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE agent_definitions (
        id TEXT PRIMARY KEY, name TEXT, tier INTEGER, division TEXT,
        provider TEXT, model TEXT, skill_path TEXT,
        config_yaml TEXT, config_hash TEXT, status TEXT,
        created_at TEXT, created_by TEXT, updated_at TEXT
      );
      CREATE TABLE agent_budgets (agent_id TEXT PRIMARY KEY);
    `);

    // Simulate 5 existing agents
    for (let i = 0; i < 5; i++) {
      db.prepare(
        "INSERT INTO agent_definitions (id,name,tier,division,provider,model,skill_path,config_yaml,config_hash,status,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(`existing-${i}`, `Agent ${i}`, 1, "engineering", "openai", "gpt-4o", "", "{}", "hash", "stopped", new Date().toISOString(), "test", new Date().toISOString());
    }

    // This should succeed — no SidjuaError expected
    const { AgentRegistry } = await import("../../src/agent-lifecycle/agent-registry.js");
    const registry = new AgentRegistry(db);
    const row = registry.create({
      id: "new-agent", name: "New", tier: 1, division: "engineering",
      provider: "openai", model: "gpt-4o", skill: "",
    });
    expect(row.id).toBe("new-agent");
    db.close();
  });

  it("rejects agent creation at hard limit of 100 with LIMIT-001", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE agent_definitions (
        id TEXT PRIMARY KEY, name TEXT, tier INTEGER, division TEXT,
        provider TEXT, model TEXT, skill_path TEXT,
        config_yaml TEXT, config_hash TEXT, status TEXT,
        created_at TEXT, created_by TEXT, updated_at TEXT
      );
      CREATE TABLE agent_budgets (agent_id TEXT PRIMARY KEY);
    `);

    // Fill table with 100 active (non-deleted) agents
    for (let i = 0; i < 100; i++) {
      db.prepare(
        "INSERT INTO agent_definitions (id,name,tier,division,provider,model,skill_path,config_yaml,config_hash,status,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(`agt-${i}`, `Agent ${i}`, 1, "eng", "openai", "gpt-4o", "", "{}", "hash", "stopped", new Date().toISOString(), "test", new Date().toISOString());
    }

    const { AgentRegistry } = await import("../../src/agent-lifecycle/agent-registry.js");
    const registry = new AgentRegistry(db);

    const { SidjuaError } = await import("../../src/core/error-codes.js");
    expect(() => registry.create({
      id: "over-limit", name: "Over", tier: 1, division: "eng",
      provider: "openai", model: "gpt-4o", skill: "",
    })).toThrow(SidjuaError);

    try {
      registry.create({ id: "over-limit-2", name: "Over2", tier: 1, division: "eng", provider: "openai", model: "gpt-4o", skill: "" });
    } catch (e) {
      expect((e as import("../../src/core/error-codes.js").SidjuaError).code).toBe("LIMIT-001");
    }
    db.close();
  });

  it("deleted agents do not count toward the limit", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE agent_definitions (
        id TEXT PRIMARY KEY, name TEXT, tier INTEGER, division TEXT,
        provider TEXT, model TEXT, skill_path TEXT,
        config_yaml TEXT, config_hash TEXT, status TEXT,
        created_at TEXT, created_by TEXT, updated_at TEXT
      );
      CREATE TABLE agent_budgets (agent_id TEXT PRIMARY KEY);
    `);

    // 99 active + 1 deleted = 99 active (below hard limit)
    for (let i = 0; i < 99; i++) {
      db.prepare(
        "INSERT INTO agent_definitions (id,name,tier,division,provider,model,skill_path,config_yaml,config_hash,status,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(`agt-${i}`, `Agent ${i}`, 1, "eng", "openai", "gpt-4o", "", "{}", "hash", "stopped", new Date().toISOString(), "test", new Date().toISOString());
    }
    db.prepare(
      "INSERT INTO agent_definitions (id,name,tier,division,provider,model,skill_path,config_yaml,config_hash,status,created_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("deleted-one", "Deleted", 1, "eng", "openai", "gpt-4o", "", "{}", "hash", "deleted", new Date().toISOString(), "test", new Date().toISOString());

    const { AgentRegistry } = await import("../../src/agent-lifecycle/agent-registry.js");
    const registry = new AgentRegistry(db);
    // Should succeed — only 99 non-deleted agents
    const row = registry.create({
      id: "new-after-delete", name: "New", tier: 1, division: "eng",
      provider: "openai", model: "gpt-4o", skill: "",
    });
    expect(row.id).toBe("new-after-delete");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Task 2 — WAL mode + busy_timeout
// ---------------------------------------------------------------------------

describe("Task 2: openDatabase() — WAL mode + busy_timeout", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "sidjua-wal-test-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("openDatabase sets journal_mode=WAL", async () => {
    const { openDatabase } = await import("../../src/utils/db.js");
    const db = openDatabase(join(tmpDir, "test.db"));
    const row = db.prepare<[], { journal_mode: string }>("PRAGMA journal_mode").get() as { journal_mode: string };
    db.close();
    expect(row.journal_mode).toBe("wal");
  });

  it("openDatabase sets busy_timeout=5000", async () => {
    const { openDatabase } = await import("../../src/utils/db.js");
    const db = openDatabase(join(tmpDir, "test2.db"));
    const row = db.prepare<[], { timeout: number }>("PRAGMA busy_timeout").get() as { timeout: number };
    db.close();
    expect(row.timeout).toBe(5000);
  });

  it("openDatabase sets synchronous=NORMAL (1)", async () => {
    const { openDatabase } = await import("../../src/utils/db.js");
    const db = openDatabase(join(tmpDir, "test3.db"));
    const row = db.prepare<[], { synchronous: number }>("PRAGMA synchronous").get() as { synchronous: number };
    db.close();
    expect(row.synchronous).toBe(1); // 1 = NORMAL
  });

  it("source contains all three PRAGMA statements", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/utils/db.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("journal_mode=WAL");
    expect(src).toContain("synchronous=NORMAL");
    expect(src).toContain("busy_timeout=5000");
  });

  it("key-store.ts uses openDatabase instead of new Database directly", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/api/key-store.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("openDatabase(dbPath)");
    expect(src).not.toContain("new Database(dbPath)");
  });
});

// ---------------------------------------------------------------------------
// Task 3 — WAL checksum race condition fix
// ---------------------------------------------------------------------------

describe("Task 3: WALManager.appendWAL — atomic transaction", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "sidjua-wal-checksum-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("source wraps the two-step insert in db.transaction()", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/agent-lifecycle/checkpoint/wal-manager.ts"),
      "utf8",
    ) as string;
    // Must contain the transaction wrapper
    expect(src).toContain("this.db.transaction(");
    // The INSERT and UPDATE must both be inside the transaction block
    const txStart = src.indexOf("this.db.transaction(");
    const txEnd   = src.indexOf(")();", txStart);
    const txBlock = src.slice(txStart, txEnd);
    expect(txBlock).toContain("INSERT INTO agent_wal");
    expect(txBlock).toContain("UPDATE agent_wal SET checksum");
  });

  it("appended WAL entry has a valid checksum (non-empty) immediately", async () => {
    const { openDatabase } = await import("../../src/utils/db.js");
    const { WALManager }   = await import("../../src/agent-lifecycle/checkpoint/wal-manager.js");

    const db = openDatabase(join(tmpDir, "wal.db"));
    db.exec(`
      CREATE TABLE agent_wal (
        sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id  TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        data_json TEXT NOT NULL,
        checksum  TEXT NOT NULL
      )
    `);

    const mgr = new WALManager(db);
    const seq = mgr.appendWAL({ agent_id: "test-agent", operation: "TEST_OP", data: { foo: "bar" } });

    const row = db.prepare<[number], { checksum: string; sequence: number }>(
      "SELECT sequence, checksum FROM agent_wal WHERE sequence = ?",
    ).get(seq) as { checksum: string; sequence: number };

    expect(row).toBeDefined();
    expect(row.checksum.length).toBeGreaterThan(0);
    expect(row.checksum).not.toBe("");
    expect(mgr.verifyEntry({
      sequence:  row.sequence,
      agent_id:  "test-agent",
      timestamp: db.prepare<[number], { timestamp: string }>("SELECT timestamp FROM agent_wal WHERE sequence = ?").get(seq)!.timestamp,
      operation: "TEST_OP",
      data_json: JSON.stringify({ foo: "bar" }),
      checksum:  row.checksum,
    })).toBe(true);

    db.close();
  });

  it("no WAL entry exists with empty checksum after appendWAL", async () => {
    const { openDatabase } = await import("../../src/utils/db.js");
    const { WALManager }   = await import("../../src/agent-lifecycle/checkpoint/wal-manager.js");

    const db = openDatabase(join(tmpDir, "wal2.db"));
    db.exec(`
      CREATE TABLE agent_wal (
        sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id  TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        data_json TEXT NOT NULL,
        checksum  TEXT NOT NULL
      )
    `);

    const mgr = new WALManager(db);
    mgr.appendWAL({ agent_id: "agent-a", operation: "OP_1", data: "payload" });
    mgr.appendWAL({ agent_id: "agent-a", operation: "OP_2", data: "payload2" });

    const emptyChecksums = db
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM agent_wal WHERE checksum = ''")
      .get() as { count: number };
    expect(emptyChecksums.count).toBe(0);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Task 4 — CLI DB connection closing
// ---------------------------------------------------------------------------

describe("Task 4: CLI commands — try/finally DB closing", () => {
  it("logs.ts runLogsCommand wraps DB usage in try/finally", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/logs.ts"),
      "utf8",
    ) as string;
    // Find the function and check for try/finally pattern
    const fnStart = src.indexOf("export async function runLogsCommand");
    const fnBlock = src.slice(fnStart, fnStart + 1500);
    expect(fnBlock).toContain("try {");
    expect(fnBlock).toContain("} finally {");
    expect(fnBlock).toContain("db.close()");
  });

  it("costs.ts runCostsCommand uses try/finally for DB closing", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/costs.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("} finally {");
    // Should only have ONE db.close() in the finally block, not scattered
    const closeCalls = (src.match(/db\.close\(\)/g) ?? []).length;
    expect(closeCalls).toBe(1);
  });

  it("run.ts runRunCommand uses try/finally for DB closing", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/run.ts"),
      "utf8",
    ) as string;
    // Find the main function body (after db open)
    const dbOpenPos = src.indexOf("const db = openCliDatabase({ workDir: opts.workDir });");
    const afterOpen = src.slice(dbOpenPos, dbOpenPos + 3000);
    expect(afterOpen).toContain("try {");
    expect(afterOpen).toContain("} finally {");
    expect(afterOpen).toContain("db.close()");
  });
});
