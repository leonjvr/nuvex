/**
 * Integration test: WAL replay accuracy
 *
 * Scenario: Checkpoint → 5 WAL ops → recover → verify state reconstruction.
 */

import { describe, it, expect } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { WALManager } from "../../../src/agent-lifecycle/checkpoint/wal-manager.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

function makeDb(agentId: string) {
  const db = new BetterSQLite3(":memory:");
  runMigrations105(db);
  db.prepare(`
    INSERT INTO agent_definitions
      (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
    VALUES (?, 'Replay Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
            '/s.md', 'id: x', 'h', 'active', datetime('now'), 'system', datetime('now'))
  `).run(agentId);
  return db;
}

describe("WAL replay accuracy (integration)", () => {
  it("checkpoint + 5 WAL ops → recover returns all ops after checkpoint", () => {
    const agentId = "agent-replay";
    const db = makeDb(agentId);
    const wal = new WALManager(db);
    const cm = new CheckpointManager(db, wal, Logger.silent());

    // Seed a checkpoint
    cm.createCheckpoint({ agent_id: agentId, type: "periodic", state: { step: 0 } });

    // Append 5 WAL ops after checkpoint
    const ops = ["STEP_1", "STEP_2", "STEP_3", "STEP_4", "STEP_5"];
    for (const op of ops) {
      wal.appendWAL({ agent_id: agentId, operation: op, data: { op } });
    }

    const result = cm.recover(agentId);
    expect(result.mode).toBe("full_recovery");
    expect(result.checkpoint?.state["step"]).toBe(0);
    expect(result.wal_entries).toHaveLength(5);
    expect(result.wal_entries.map((e) => e.operation)).toEqual(ops);

    // Verify all WAL entries have valid checksums
    for (const entry of result.wal_entries) {
      expect(wal.verifyEntry(entry)).toBe(true);
    }
  });
});
