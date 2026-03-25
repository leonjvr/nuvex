/**
 * Integration test: Full graceful shutdown cycle with mock exit function.
 */

import { describe, it, expect, vi } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import { GracefulShutdownHandler } from "../../../src/agent-lifecycle/supervisor/graceful-shutdown.js";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

describe("Graceful shutdown cycle (integration)", () => {
  it("full shutdown sequence persists clean state and calls exit(0)", async () => {
    const db = new BetterSQLite3(":memory:");
    runMigrations105(db);

    // Insert an agent for checkpoint during shutdown
    db.prepare(`
      INSERT INTO agent_definitions
        (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
      VALUES ('agent-shutdown', 'Shutdown Agent', 1, 'eng', 'anthropic', 'claude-sonnet-4-6',
              '/s.md', 'id: x', 'h', 'active', datetime('now'), 'system', datetime('now'))
    `).run();

    const cm = new CheckpointManager(db, undefined, Logger.silent());
    const handler = new GracefulShutdownHandler(
      { agent_ids: ["agent-shutdown"], agent_drain_timeout_ms: 50, checkpoint_timeout_ms: 50 },
      db,
      cm,
      Logger.silent(),
    );

    const exitFn = vi.fn();
    handler.setShutdownCallback(exitFn);

    const notifyFn = vi.fn().mockResolvedValue(undefined);
    const cpFn = vi.fn().mockResolvedValue(undefined);
    handler.setNotifyAgentsFn(notifyFn);
    handler.setCheckpointAgentsFn(cpFn);

    await handler.initiateShutdown("SIGTERM");

    // Verify exit was called with 0
    expect(exitFn).toHaveBeenCalledWith(0);

    // Verify system_state.shutdown_clean = 'true'
    const row = db
      .prepare<[string], { value: string }>("SELECT value FROM system_state WHERE key = ?")
      .get("shutdown_clean");
    expect(row?.value).toBe("true");

    // Verify agent callbacks were invoked
    expect(notifyFn).toHaveBeenCalledWith("SIGTERM");
    expect(cpFn).toHaveBeenCalled();

    // Verify status
    const status = handler.getShutdownStatus();
    expect(status.completed).toBe(true);
    expect(status.reason).toBe("SIGTERM");
  });
});
