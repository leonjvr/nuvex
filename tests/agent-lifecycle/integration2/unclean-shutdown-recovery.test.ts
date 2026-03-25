/**
 * Integration test: Unclean shutdown recovery.
 *
 * Seeds system_state.shutdown_clean=false, inserts active agents,
 * then runs StartupRecoveryManager.recover() and verifies the report.
 */

import { describe, it, expect } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import { StartupRecoveryManager } from "../../../src/agent-lifecycle/supervisor/startup-recovery.js";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { AgentRegistry } from "../../../src/agent-lifecycle/agent-registry.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

describe("Unclean shutdown recovery (integration)", () => {
  it("seed unclean system_state → recover() → produces non-empty report", () => {
    const db = new BetterSQLite3(":memory:");
    runMigrations105(db);

    // Mark shutdown as unclean
    db.prepare(
      "INSERT OR REPLACE INTO system_state (key, value, updated_at) VALUES ('shutdown_clean', 'false', datetime('now'))",
    ).run();

    // Insert two active agents
    for (const id of ["agent-uc-1", "agent-uc-2"]) {
      db.prepare(`
        INSERT INTO agent_definitions
          (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
        VALUES (?, 'UC Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
                '/s.md', 'id: x', 'h', 'active', datetime('now'), 'system', datetime('now'))
      `).run(id);
    }

    const cm = new CheckpointManager(db, undefined, Logger.silent());
    const registry = new AgentRegistry(db);
    const srm = new StartupRecoveryManager(db, cm, registry, Logger.silent());

    const report = srm.recover();
    expect(report.shutdown_was_clean).toBe(false);
    expect(report.agents_recovered).toBe(2);
    expect(report.results.every((r) => r.mode === "clean_start")).toBe(true);
  });
});
