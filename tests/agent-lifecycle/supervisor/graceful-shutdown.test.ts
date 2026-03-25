/**
 * Unit tests: GracefulShutdownHandler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { GracefulShutdownHandler } from "../../../src/agent-lifecycle/supervisor/graceful-shutdown.js";
import { CheckpointManager } from "../../../src/agent-lifecycle/checkpoint/checkpoint-manager.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import { Logger } from "../../../src/utils/logger.js";

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runMigrations105(db);
  return db;
}

const silent = Logger.silent();

function makeHandler(db: Database) {
  const cm = new CheckpointManager(db, undefined, silent);
  return new GracefulShutdownHandler(
    { agent_drain_timeout_ms: 100, checkpoint_timeout_ms: 100 },
    db,
    cm,
    silent,
  );
}

describe("GracefulShutdownHandler", () => {
  let db: Database;
  let handler: GracefulShutdownHandler;

  beforeEach(() => {
    db = makeDb();
    handler = makeHandler(db);
  });

  it("register installs signal handlers without throwing", () => {
    // Can only verify it doesn't throw; we can't easily test actual signal delivery
    expect(() => handler.register()).not.toThrow();
    // Clean up registered handlers (not practical in vitest, but registration itself is tested)
  });

  it("initiateShutdown calls the injectable exit callback instead of process.exit", async () => {
    const exitFn = vi.fn();
    handler.setShutdownCallback(exitFn);
    await handler.initiateShutdown("manual");
    expect(exitFn).toHaveBeenCalledWith(0);
  });

  it("initiateShutdown sets shutdown_clean=true in system_state", async () => {
    handler.setShutdownCallback(() => undefined);
    await handler.initiateShutdown("SIGTERM");

    const row = db.prepare<[string], { value: string }>(
      "SELECT value FROM system_state WHERE key = ?",
    ).get("shutdown_clean");
    expect(row?.value).toBe("true");
  });

  it("getShutdownStatus.initiated is false before shutdown", () => {
    expect(handler.getShutdownStatus().initiated).toBe(false);
  });

  it("getShutdownStatus reflects state after shutdown", async () => {
    handler.setShutdownCallback(() => undefined);
    await handler.initiateShutdown("SIGINT");
    const status = handler.getShutdownStatus();
    expect(status.initiated).toBe(true);
    expect(status.reason).toBe("SIGINT");
    expect(status.completed).toBe(true);
  });

  it("isDraining returns true after initiateShutdown is called", async () => {
    handler.setShutdownCallback(() => undefined);
    // Start shutdown but don't await (check draining mid-sequence)
    const promise = handler.initiateShutdown("manual");
    // isDraining is set synchronously at step 1
    expect(handler.isDraining()).toBe(true);
    await promise;
  });

  it("notifyAgentsFn and checkpointAgentsFn are called during shutdown", async () => {
    const notifyFn = vi.fn().mockResolvedValue(undefined);
    const checkpointFn = vi.fn().mockResolvedValue(undefined);
    handler.setNotifyAgentsFn(notifyFn);
    handler.setCheckpointAgentsFn(checkpointFn);
    handler.setShutdownCallback(() => undefined);

    await handler.initiateShutdown("manual");

    expect(notifyFn).toHaveBeenCalledWith("manual");
    expect(checkpointFn).toHaveBeenCalled();
  });

  it("second initiateShutdown call is ignored (idempotent)", async () => {
    const exitFn = vi.fn();
    handler.setShutdownCallback(exitFn);
    await handler.initiateShutdown("manual");
    await handler.initiateShutdown("manual");
    expect(exitFn).toHaveBeenCalledTimes(1);
  });
});
