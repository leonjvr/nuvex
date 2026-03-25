/**
 * Integration test: 3 agents in DB → unclean shutdown → all 3 recover.
 */

import { describe, it, expect } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import { StartupRecoveryManager } from "../../../src/agent-lifecycle/supervisor/startup-recovery.js";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { AgentRegistry } from "../../../src/agent-lifecycle/agent-registry.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

describe("Multi-agent recovery (integration)", () => {
  it("3 active agents → all 3 appear in recovery report", () => {
    const db = new BetterSQLite3(":memory:");
    runMigrations105(db);

    // Mark unclean
    db.prepare(
      "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('shutdown_clean', 'false', datetime('now'))",
    ).run();

    // Insert 3 active agents
    const agents = ["agent-m1", "agent-m2", "agent-m3"];
    for (const id of agents) {
      db.prepare(`
        INSERT INTO agent_definitions
          (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
        VALUES (?, 'Multi Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
                '/s.md', 'id: x', 'h', 'active', datetime('now'), 'system', datetime('now'))
      `).run(id);
    }

    const cm = new CheckpointManager(db, undefined, Logger.silent());
    const registry = new AgentRegistry(db);
    const srm = new StartupRecoveryManager(db, cm, registry, Logger.silent());

    const report = srm.recover();
    expect(report.shutdown_was_clean).toBe(false);
    expect(report.agents_recovered).toBe(3);

    const recoveredIds = report.results.map((r) => r.agent_id).sort();
    expect(recoveredIds).toEqual(agents.sort());
  });

  it("processing agents are also recovered", () => {
    const db = new BetterSQLite3(":memory:");
    runMigrations105(db);

    db.prepare(
      "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('shutdown_clean', 'false', datetime('now'))",
    ).run();

    // One active, one processing, one stopped
    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES ('ag-active', 'A', 1, 'eng', 'anthropic', 'claude-sonnet-4-6', '/s.md', 'x', 'h', 'active', datetime('now'), 'system', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES ('ag-processing', 'B', 1, 'eng', 'anthropic', 'claude-sonnet-4-6', '/s.md', 'x', 'h', 'processing', datetime('now'), 'system', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES ('ag-stopped', 'C', 1, 'eng', 'anthropic', 'claude-sonnet-4-6', '/s.md', 'x', 'h', 'stopped', datetime('now'), 'system', datetime('now'))
    `).run();

    const cm = new CheckpointManager(db, undefined, Logger.silent());
    const registry = new AgentRegistry(db);
    const srm = new StartupRecoveryManager(db, cm, registry, Logger.silent());

    const report = srm.recover();
    expect(report.agents_recovered).toBe(2); // active + processing, not stopped
    const ids = report.results.map((r) => r.agent_id).sort();
    expect(ids).toContain("ag-active");
    expect(ids).toContain("ag-processing");
    expect(ids).not.toContain("ag-stopped");
  });
});
