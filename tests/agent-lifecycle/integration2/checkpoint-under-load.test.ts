/**
 * Integration test: WAL append + checkpoint + WAL append → recovery preserves all ops.
 */

import { describe, it, expect } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { WALManager } from "../../../src/agent-lifecycle/checkpoint/wal-manager.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

describe("Checkpoint under load (integration)", () => {
  it("WAL append → checkpoint → WAL append → recovery returns post-checkpoint WAL", () => {
    const agentId = "agent-load";
    const db = new BetterSQLite3(":memory:");
    runMigrations105(db);
    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES (?, 'Load Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
              '/s.md', 'id: x', 'h', 'active', datetime('now'), 'system', datetime('now'))
    `).run(agentId);

    const wal = new WALManager(db);
    const cm = new CheckpointManager(db, wal, Logger.silent());

    // Phase 1: pre-checkpoint WAL ops
    wal.appendWAL({ agent_id: agentId, operation: "PRE_OP_1", data: {} });
    wal.appendWAL({ agent_id: agentId, operation: "PRE_OP_2", data: {} });
    wal.appendWAL({ agent_id: agentId, operation: "PRE_OP_3", data: {} });

    // Checkpoint (truncates pre-checkpoint WAL)
    cm.createCheckpoint({ agent_id: agentId, type: "periodic", state: { phase: "mid" } });

    // Phase 2: post-checkpoint WAL ops
    wal.appendWAL({ agent_id: agentId, operation: "POST_OP_1", data: {} });
    wal.appendWAL({ agent_id: agentId, operation: "POST_OP_2", data: {} });

    // Recovery
    const result = cm.recover(agentId);
    expect(result.mode).toBe("full_recovery");
    expect(result.checkpoint?.state["phase"]).toBe("mid");
    // Only post-checkpoint WAL ops are returned
    expect(result.wal_entries.map((e) => e.operation)).toEqual(["POST_OP_1", "POST_OP_2"]);
    // Pre-checkpoint ops should be gone
    expect(result.wal_entries.find((e) => e.operation.startsWith("PRE"))).toBeUndefined();
  });

  it("all recovered WAL entries have valid checksums", () => {
    const agentId = "agent-checksum";
    const db = new BetterSQLite3(":memory:");
    runMigrations105(db);
    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES (?, 'Checksum Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
              '/s.md', 'id: x', 'h', 'active', datetime('now'), 'system', datetime('now'))
    `).run(agentId);

    const wal = new WALManager(db);
    const cm = new CheckpointManager(db, wal, Logger.silent());

    cm.createCheckpoint({ agent_id: agentId, type: "periodic", state: {} });

    for (let i = 0; i < 10; i++) {
      wal.appendWAL({ agent_id: agentId, operation: `OP_${i}`, data: { idx: i } });
    }

    const result = cm.recover(agentId);
    expect(result.wal_entries).toHaveLength(10);
    for (const entry of result.wal_entries) {
      expect(wal.verifyEntry(entry)).toBe(true);
    }
  });
});
