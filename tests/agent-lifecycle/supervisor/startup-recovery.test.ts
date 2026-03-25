/**
 * Unit tests: StartupRecoveryManager
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { StartupRecoveryManager } from "../../../src/agent-lifecycle/supervisor/startup-recovery.js";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { AgentRegistry } from "../../../src/agent-lifecycle/agent-registry.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runMigrations105(db);
  return db;
}

function setSystemState(db: Database, key: string, value: string): void {
  db.prepare<[string, string, string], void>(`
    INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

const silent = Logger.silent();

describe("StartupRecoveryManager", () => {
  let db: Database;
  let cm: CheckpointManager;
  let registry: AgentRegistry;
  let srm: StartupRecoveryManager;

  beforeEach(() => {
    db = makeDb();
    cm = new CheckpointManager(db, undefined, silent);
    registry = new AgentRegistry(db);
    srm = new StartupRecoveryManager(db, cm, registry, silent);
  });

  it("clean shutdown → no recovery, agents_recovered = 0", () => {
    setSystemState(db, "shutdown_clean", "true");
    const report = srm.recover();
    expect(report.shutdown_was_clean).toBe(true);
    expect(report.agents_recovered).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  it("unclean shutdown + no active agents → agents_recovered = 0", () => {
    setSystemState(db, "shutdown_clean", "false");
    const report = srm.recover();
    expect(report.shutdown_was_clean).toBe(false);
    expect(report.agents_recovered).toBe(0);
  });

  it("unclean shutdown + active agent → recover() is called for that agent", () => {
    setSystemState(db, "shutdown_clean", "false");

    // Insert an active agent
    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES ('agent-active', 'Active Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
              '/skills/test.md', 'id: agent-active', 'hash3', 'active', datetime('now'), 'system', datetime('now'))
    `).run();

    const report = srm.recover();
    expect(report.shutdown_was_clean).toBe(false);
    expect(report.agents_recovered).toBe(1);
    expect(report.results[0]?.agent_id).toBe("agent-active");
    // No checkpoint exists → clean_start
    expect(report.results[0]?.mode).toBe("clean_start");
  });

  it("full_recovery path when agent has a checkpoint", () => {
    setSystemState(db, "shutdown_clean", "false");

    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES ('agent-full', 'Full Recovery Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
              '/skills/test.md', 'id: agent-full', 'hash4', 'active', datetime('now'), 'system', datetime('now'))
    `).run();

    // Create a checkpoint for the agent
    cm.createCheckpoint({ agent_id: "agent-full", type: "shutdown", state: { restored: true } });

    const report = srm.recover();
    expect(report.results[0]?.mode).toBe("full_recovery");
    expect(report.results[0]?.checkpoint?.state["restored"]).toBe(true);
  });

  it("shutdown_clean is set to false after clean recovery (marks current session as unclean)", () => {
    setSystemState(db, "shutdown_clean", "true");
    srm.recover();

    const row = db.prepare<[string], { value: string }>(
      "SELECT value FROM system_state WHERE key = ?",
    ).get("shutdown_clean");
    expect(row?.value).toBe("false");
  });
});
