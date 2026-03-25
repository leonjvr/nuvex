/**
 * Unit tests: WALManager
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { WALManager } from "../../../src/agent-lifecycle/checkpoint/wal-manager.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  // Need agent_definitions for FK; insert a stub row
  runMigrations105(db);
  db.prepare(`
    INSERT INTO agent_definitions
      (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
    VALUES ('agent-wal', 'WAL Test Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
            '/skills/test.md', 'id: agent-wal', 'hash1', 'active', datetime('now'), 'system', datetime('now'))
  `).run();
  return db;
}

describe("WALManager", () => {
  let db: Database;
  let wal: WALManager;

  beforeEach(() => {
    db = makeDb();
    wal = new WALManager(db);
  });

  it("appendWAL returns an incrementing sequence number", () => {
    const seq1 = wal.appendWAL({ agent_id: "agent-wal", operation: "TASK_START", data: { task: "t1" } });
    const seq2 = wal.appendWAL({ agent_id: "agent-wal", operation: "TASK_END", data: { task: "t1" } });
    expect(seq1).toBeGreaterThan(0);
    expect(seq2).toBe(seq1 + 1);
  });

  it("getWALSince returns entries after the given sequence", () => {
    const seq1 = wal.appendWAL({ agent_id: "agent-wal", operation: "OP_A", data: {} });
    wal.appendWAL({ agent_id: "agent-wal", operation: "OP_B", data: {} });
    wal.appendWAL({ agent_id: "agent-wal", operation: "OP_C", data: {} });

    const entries = wal.getWALSince("agent-wal", seq1);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.operation).toBe("OP_B");
    expect(entries[1]?.operation).toBe("OP_C");
  });

  it("getWALSince returns empty array when no entries exist", () => {
    const entries = wal.getWALSince("agent-wal", 0);
    expect(entries).toEqual([]);
  });

  it("truncateWAL removes entries before given sequence", () => {
    const seq1 = wal.appendWAL({ agent_id: "agent-wal", operation: "OP_1", data: {} });
    const seq2 = wal.appendWAL({ agent_id: "agent-wal", operation: "OP_2", data: {} });
    wal.appendWAL({ agent_id: "agent-wal", operation: "OP_3", data: {} });

    wal.truncateWAL("agent-wal", seq2);

    // seq1 and seq2 were before beforeSequence=seq2; seq2 is NOT deleted (strict <)
    // Wait — the spec says DELETE WHERE sequence < beforeSequence
    // So seq1 is deleted, seq2 and seq3 remain
    const remaining = wal.getWALSince("agent-wal", 0);
    expect(remaining.map((e) => e.operation)).toEqual(["OP_2", "OP_3"]);
    void seq1; // used above
  });

  it("verifyEntry returns true for valid entry", () => {
    wal.appendWAL({ agent_id: "agent-wal", operation: "OP_OK", data: { x: 1 } });
    const entries = wal.getWALSince("agent-wal", 0);
    expect(entries).toHaveLength(1);
    expect(wal.verifyEntry(entries[0]!)).toBe(true);
  });

  it("verifyEntry returns false for tampered entry", () => {
    wal.appendWAL({ agent_id: "agent-wal", operation: "OP_TAMPER", data: { secret: "safe" } });
    const entries = wal.getWALSince("agent-wal", 0);
    const tampered = { ...entries[0]!, data_json: '{"secret":"HACKED"}' };
    expect(wal.verifyEntry(tampered)).toBe(false);
  });
});
