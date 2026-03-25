// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/update/lock-manager.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import { FileLockManager } from "../../../src/core/update/lock-manager.js";
import { SidjuaError }     from "../../../src/core/error-codes.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-lock-test-"));
}

/** Write a lock file with a timestamp 2 hours in the past (stale). */
function writeStaleLock(lockPath: string, pid: number): void {
  const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
  const lockInfo = { pid, hostname: "test-host", acquiredAt: twoHoursAgo, operation: "update" };
  writeFileSync(lockPath, JSON.stringify(lockInfo));
  // Also set mtime to 2 hours ago so malformed-file path also sees it as stale
  const staleDate = new Date(Date.now() - 7_200_000);
  utimesSync(lockPath, staleDate, staleDate);
}

describe("FileLockManager", () => {
  let tmp: string;
  let mgr: FileLockManager;

  beforeEach(() => {
    tmp = makeTempDir();
    mgr = new FileLockManager(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // acquire
  // --------------------------------------------------------------------------

  it("acquires lock when no lock file exists", async () => {
    const result = await mgr.acquire("update");
    expect(result).toBe(true);
    expect(existsSync(mgr.getLockPath())).toBe(true);
  });

  it("second acquire throws LOCK-001 when locked by live process", async () => {
    await mgr.acquire("update");
    let caught: unknown;
    try {
      await mgr.acquire("update");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SidjuaError);
    expect((caught as SidjuaError).code).toBe("LOCK-001");
  });

  it("lock info contains pid, hostname, timestamp, and operation", async () => {
    await mgr.acquire("rollback");
    const info = await mgr.getLockInfo();
    expect(info).not.toBeNull();
    expect(info!.pid).toBe(process.pid);
    expect(info!.operation).toBe("rollback");
    expect(typeof info!.acquiredAt).toBe("string");
    expect(new Date(info!.acquiredAt).toISOString()).toBe(info!.acquiredAt);
    expect(typeof info!.hostname).toBe("string");
  });

  it("isLocked returns true after acquire", async () => {
    await mgr.acquire("update");
    const locked = await mgr.isLocked();
    expect(locked).toBe(true);
  });

  it("isLocked returns false when no lock file", async () => {
    const locked = await mgr.isLocked();
    expect(locked).toBe(false);
  });

  // --------------------------------------------------------------------------
  // release
  // --------------------------------------------------------------------------

  it("release removes lock file", async () => {
    await mgr.acquire("update");
    await mgr.release();
    expect(existsSync(mgr.getLockPath())).toBe(false);
  });

  it("release is a no-op when no lock exists", async () => {
    await expect(mgr.release()).resolves.not.toThrow();
  });

  it("release does not remove lock held by another pid", async () => {
    // Write a lock file with a different PID that IS running (pid 1 = init/systemd)
    const lockInfo = { pid: 1, hostname: "test-host", acquiredAt: new Date().toISOString(), operation: "update" };
    writeFileSync(mgr.getLockPath(), JSON.stringify(lockInfo));
    await mgr.release();
    // Lock should still exist since we don't own it
    expect(existsSync(mgr.getLockPath())).toBe(true);
  });

  // --------------------------------------------------------------------------
  // forceRelease
  // --------------------------------------------------------------------------

  it("forceRelease removes lock regardless of owner", async () => {
    const lockInfo = { pid: 1, hostname: "test-host", acquiredAt: new Date().toISOString(), operation: "update" };
    writeFileSync(mgr.getLockPath(), JSON.stringify(lockInfo));
    await mgr.forceRelease();
    expect(existsSync(mgr.getLockPath())).toBe(false);
  });

  it("forceRelease is a no-op when no lock exists", async () => {
    await expect(mgr.forceRelease()).resolves.not.toThrow();
  });

  // --------------------------------------------------------------------------
  // Stale lock detection (dead PID + age > 1 hour)
  // --------------------------------------------------------------------------

  it("acquire reclaims stale lock (dead pid + >1h old)", async () => {
    // Write a lock with a dead PID and old timestamp (stale)
    writeStaleLock(mgr.getLockPath(), 99999999);

    const result = await mgr.acquire("update");
    expect(result).toBe(true);
    const info = await mgr.getLockInfo();
    expect(info!.pid).toBe(process.pid);
  });

  it("acquire throws LOCK-001 for young lock with dead pid (not yet stale)", async () => {
    // Write a lock with a dead PID but current timestamp — not stale
    const lockInfo = { pid: 99999999, hostname: "test-host", acquiredAt: new Date().toISOString(), operation: "update" };
    writeFileSync(mgr.getLockPath(), JSON.stringify(lockInfo));
    let caught: unknown;
    try {
      await mgr.acquire("update");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SidjuaError);
    expect((caught as SidjuaError).code).toBe("LOCK-001");
  });

  // --------------------------------------------------------------------------
  // getLockAge
  // --------------------------------------------------------------------------

  it("getLockAge returns null when no lock exists", () => {
    expect(mgr.getLockAge()).toBeNull();
  });

  it("getLockAge returns a non-negative number after acquire", async () => {
    await mgr.acquire("update");
    const age = mgr.getLockAge();
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(0);
  });

  // --------------------------------------------------------------------------
  // Malformed lock file
  // --------------------------------------------------------------------------

  it("getLockInfo returns null for malformed lock file", async () => {
    writeFileSync(mgr.getLockPath(), "{{{not-json");
    const info = await mgr.getLockInfo();
    expect(info).toBeNull();
  });

  it("acquire throws LOCK-002 for malformed lock file less than 1h old", async () => {
    writeFileSync(mgr.getLockPath(), "{{{not-json");
    let caught: unknown;
    try {
      await mgr.acquire("update");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SidjuaError);
    expect((caught as SidjuaError).code).toBe("LOCK-002");
  });

  it("acquire reclaims malformed lock file older than 1h", async () => {
    writeFileSync(mgr.getLockPath(), "{{{not-json");
    // Backdate mtime to 2 hours ago
    const staleDate = new Date(Date.now() - 7_200_000);
    utimesSync(mgr.getLockPath(), staleDate, staleDate);

    const result = await mgr.acquire("update");
    expect(result).toBe(true);
  });
});
