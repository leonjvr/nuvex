/**
 * Unit tests: CheckpointManager
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { WALManager } from "../../../src/agent-lifecycle/checkpoint/wal-manager.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

function makeDb(agentId = "agent-cp"): Database {
  const db = new BetterSQLite3(":memory:");
  runMigrations105(db);
  db.prepare(`
    INSERT INTO agent_definitions
      (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
    VALUES (?, 'CP Test Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
            '/skills/test.md', 'id: test', 'hash2', 'active', datetime('now'), 'system', datetime('now'))
  `).run(agentId);
  return db;
}

const silent = Logger.silent();

describe("CheckpointManager", () => {
  let db: Database;
  let walManager: WALManager;
  let cm: CheckpointManager;

  beforeEach(() => {
    db = makeDb();
    walManager = new WALManager(db);
    cm = new CheckpointManager(db, walManager, silent);
  });

  it("createCheckpoint writes a row to agent_checkpoints", () => {
    const cp = cm.createCheckpoint({
      agent_id: "agent-cp",
      type: "periodic",
      state: { task_count: 3 },
    });
    expect(cp.id).toBeTruthy();
    expect(cp.type).toBe("periodic");
    expect(cp.state["task_count"]).toBe(3);
  });

  it("getLastCheckpoint reads back the most recent checkpoint", () => {
    cm.createCheckpoint({ agent_id: "agent-cp", type: "periodic", state: { v: 1 } });
    cm.createCheckpoint({ agent_id: "agent-cp", type: "shutdown", state: { v: 2 } });
    const last = cm.getLastCheckpoint("agent-cp");
    expect(last?.type).toBe("shutdown");
    expect(last?.state["v"]).toBe(2);
  });

  it("getLastCheckpoint returns undefined when no checkpoints exist", () => {
    expect(cm.getLastCheckpoint("agent-cp")).toBeUndefined();
  });

  it("WAL is truncated when a checkpoint is created", () => {
    walManager.appendWAL({ agent_id: "agent-cp", operation: "OP_A", data: {} });
    walManager.appendWAL({ agent_id: "agent-cp", operation: "OP_B", data: {} });

    cm.createCheckpoint({ agent_id: "agent-cp", type: "periodic" });

    // After checkpoint, WAL entries before the checkpoint's wal_sequence should be gone
    const entries = walManager.getWALSince("agent-cp", 0);
    // wal_sequence is MAX(sequence) at checkpoint time — all prior entries truncated
    expect(entries).toHaveLength(0);
  });

  it("recover returns full_recovery when checkpoint + WAL entries exist", () => {
    cm.createCheckpoint({ agent_id: "agent-cp", type: "periodic", state: { step: 1 } });
    walManager.appendWAL({ agent_id: "agent-cp", operation: "STEP_2", data: {} });

    const result = cm.recover("agent-cp");
    expect(result.mode).toBe("full_recovery");
    expect(result.checkpoint).toBeDefined();
    expect(result.wal_entries).toHaveLength(1);
  });

  it("recover returns clean_start when no checkpoint or WAL exists", () => {
    const result = cm.recover("agent-cp");
    expect(result.mode).toBe("clean_start");
    expect(result.checkpoint).toBeUndefined();
    expect(result.wal_entries).toHaveLength(0);
  });

  it("appendWAL convenience method delegates to walManager", () => {
    const seq = cm.appendWAL({ agent_id: "agent-cp", operation: "DELEGATED", data: {} });
    expect(seq).toBeGreaterThan(0);
    const entries = walManager.getWALSince("agent-cp", 0);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.operation).toBe("DELEGATED");
  });
});
