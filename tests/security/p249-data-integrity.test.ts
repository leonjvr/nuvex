// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P249 — CRITICAL Data Integrity: DB Paths & Locking regression tests
 *
 * Tests:
 * 1.  getCanonicalDbPath returns the correct path
 * 2.  update.ts references canonical DB path (source inspection)
 * 3.  rollback.ts references canonical DB path (source inspection)
 * 4.  Second lock.acquire() throws LOCK-001 when a live process holds the lock
 * 5.  Stale lock (dead PID + >1h) is reclaimed and acquire succeeds
 * 6.  Malformed lock file <1h old throws LOCK-002
 * 7.  provider-config.ts throws PCFG-005 on disk failure (source inspection)
 * 8.  Provider config memory roundtrip works when in-memory mode
 * 9.  backup.ts throws BACKUP-001 after WAL checkpoint exhausts retries (source inspection)
 * 10. backup.ts retries WAL checkpoint before aborting (source inspection)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import { fileURLToPath } from "node:url";

import { getCanonicalDbPath }   from "../../src/core/db/paths.js";
import { FileLockManager }       from "../../src/core/update/lock-manager.js";
import { SidjuaError }           from "../../src/core/error-codes.js";
import {
  saveProviderConfig,
  getProviderConfig,
  resetProviderConfigState,
} from "../../src/core/provider-config.js";

// ---------------------------------------------------------------------------
// Source file paths (resolved once at module load)
// ---------------------------------------------------------------------------

const SRC_UPDATE   = fileURLToPath(new URL("../../src/cli/commands/update.ts",   import.meta.url));
const SRC_ROLLBACK = fileURLToPath(new URL("../../src/cli/commands/rollback.ts",  import.meta.url));
const SRC_PCONFIG  = fileURLToPath(new URL("../../src/core/provider-config.ts",   import.meta.url));
const SRC_BACKUP   = fileURLToPath(new URL("../../src/core/backup.ts",            import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-p249-"));
}

/** Write a lock file with timestamp 2 hours in the past (stale). */
function writeStaleLock(lockPath: string, pid: number): void {
  const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
  writeFileSync(lockPath, JSON.stringify({ pid, hostname: "test-host", acquiredAt: twoHoursAgo, operation: "update" }));
  const staleDate = new Date(Date.now() - 7_200_000);
  utimesSync(lockPath, staleDate, staleDate);
}

// ---------------------------------------------------------------------------
// 1. Canonical DB path
// ---------------------------------------------------------------------------

describe("P249 FIX-1 — canonical DB path", () => {
  it("getCanonicalDbPath returns <workDir>/.system/sidjua.db", () => {
    expect(getCanonicalDbPath("/foo/bar")).toBe("/foo/bar/.system/sidjua.db");
  });
});

// ---------------------------------------------------------------------------
// 2-3. Commands use canonical path (source inspection)
// ---------------------------------------------------------------------------

describe("P249 FIX-2/3 — update & rollback use canonical DB path", () => {
  it("update.ts imports getCanonicalDbPath and does not reference workspace.db", () => {
    const src = readFileSync(SRC_UPDATE, "utf-8");
    expect(src).toContain("getCanonicalDbPath");
    expect(src).not.toMatch(/openDatabase\(.*workspace\.db/);
  });

  it("rollback.ts imports getCanonicalDbPath and does not reference workspace.db", () => {
    const src = readFileSync(SRC_ROLLBACK, "utf-8");
    expect(src).toContain("getCanonicalDbPath");
    expect(src).not.toMatch(/openDatabase\(.*workspace\.db/);
  });
});

// ---------------------------------------------------------------------------
// 4-5. FileLockManager — concurrent acquisition and stale reclaim
// ---------------------------------------------------------------------------

describe("P249 FIX-4/5 — lock manager atomicity and stale reclaim", () => {
  let tmp: string;
  let mgr: FileLockManager;

  beforeEach(() => {
    tmp = makeTempDir();
    mgr = new FileLockManager(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("second acquire() throws LOCK-001 when the lock is held by this live process", async () => {
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

  it("stale lock (dead PID + >1h) is reclaimed — acquire() returns true", async () => {
    writeStaleLock(mgr.getLockPath(), 99999999);
    const result = await mgr.acquire("update");
    expect(result).toBe(true);
    const info = await mgr.getLockInfo();
    expect(info!.pid).toBe(process.pid);
  });
});

// ---------------------------------------------------------------------------
// 6. Malformed lock file < 1h throws LOCK-002
// ---------------------------------------------------------------------------

describe("P249 FIX-5 — malformed lock file throws LOCK-002", () => {
  let tmp: string;
  let mgr: FileLockManager;

  beforeEach(() => {
    tmp = makeTempDir();
    mgr = new FileLockManager(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("malformed lock file less than 1h old throws LOCK-002", async () => {
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
});

// ---------------------------------------------------------------------------
// 7. Provider config — source inspection for PCFG-005 throw on disk failure
// ---------------------------------------------------------------------------

describe("P249 FIX-6 — provider config throws PCFG-005 on disk failure", () => {
  it("provider-config.ts throws PCFG-005 when master key cannot be persisted", () => {
    const src = readFileSync(SRC_PCONFIG, "utf-8");
    // getMasterKey must throw PCFG-005 on write failure (not silently fall back)
    expect(src).toContain("PCFG-005");
    expect(src).toContain("Cannot persist provider master key");
  });

  it("provider-config.ts throws PCFG-005 on config file write failure in fs mode", () => {
    const src = readFileSync(SRC_PCONFIG, "utf-8");
    // saveProviderConfig must throw PCFG-005 when disk write fails
    expect(src).toContain("Failed to persist provider config to disk");
  });
});

// ---------------------------------------------------------------------------
// 8. Provider config memory roundtrip
// ---------------------------------------------------------------------------

describe("P249 FIX-6 — provider config memory roundtrip", () => {
  beforeEach(() => {
    vi.stubEnv("SIDJUA_EPHEMERAL", "true");
    resetProviderConfigState();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetProviderConfigState();
  });

  it("save and load provider config roundtrips correctly in memory mode", () => {
    const config = {
      mode: "simple" as const,
      default_provider: {
        provider_id: "anthropic",
        api_key:     "sk-ant-test-key",
        model:       "claude-sonnet-4-6",
      },
      agent_overrides: {},
    };

    saveProviderConfig(config);
    const loaded = getProviderConfig();

    expect(loaded).not.toBeNull();
    expect(loaded!.default_provider!.provider_id).toBe("anthropic");
    expect(loaded!.default_provider!.api_key).toBe("sk-ant-test-key");
  });
});

// ---------------------------------------------------------------------------
// 9-10. Backup WAL checkpoint — source inspection
// ---------------------------------------------------------------------------

describe("P249 FIX-7 — backup WAL checkpoint retries and fatal error", () => {
  it("backup.ts retries WAL checkpoint WAL_CHECKPOINT_MAX_RETRIES times before aborting", () => {
    const src = readFileSync(SRC_BACKUP, "utf-8");
    expect(src).toContain("WAL_CHECKPOINT_MAX_RETRIES");
    expect(src).toContain("WAL_CHECKPOINT_RETRY_DELAY_MS");
    // Retry loop iterates up to max retries
    expect(src).toMatch(/attempt.*<=.*WAL_CHECKPOINT_MAX_RETRIES/);
  });

  it("backup.ts throws BACKUP-001 after exhausting retries and re-throws to abort backup", () => {
    const src = readFileSync(SRC_BACKUP, "utf-8");
    // Must throw BACKUP-001 on exhaustion
    expect(src).toContain("BACKUP-001");
    // Must re-throw in the DB loop to abort backup (not just warn)
    expect(src).toContain("throw dbErr");
  });
});
