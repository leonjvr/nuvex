// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Update Lock Manager
 *
 * Prevents concurrent update/rollback/backup-restore operations using a
 * JSON lock file at <data-dir>/sidjua.lock.
 *
 * Acquisition is atomic via openSync(O_CREAT | O_EXCL | O_WRONLY): the OS
 * guarantees exactly one concurrent caller creates the file successfully.
 *
 * Stale lock policy: a lock is stale when the owning PID is dead AND the lock
 * file is older than one hour. Locks younger than 1 hour with a dead PID are
 * considered suspicious (reused PID, racing cleanup) and are NOT auto-reclaimed.
 */

import {
  existsSync,
  readFileSync,
  openSync,
  writeSync,
  closeSync,
  unlinkSync,
  mkdirSync,
  statSync,
  constants,
} from "node:fs";
import { hostname }    from "node:os";
import { join, dirname } from "node:path";
import { createLogger }  from "../logger.js";
import { SidjuaError }   from "../error-codes.js";

const logger = createLogger("lock-manager");

const { O_CREAT, O_EXCL, O_WRONLY } = constants;

/** A lock is stale when PID is dead AND age exceeds this threshold. */
const STALE_LOCK_AGE_MS = 3_600_000; // 1 hour


export interface LockInfo {
  pid:         number;
  hostname:    string;
  acquiredAt:  string;  // ISO timestamp
  operation:   string;  // "update" | "rollback" | "backup-restore" | "governance-update"
}


/**
 * Returns true if a process with the given PID is still running.
 * Uses process.kill(pid, 0) which sends signal 0 (no-op) — throws if not found.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    // ESRCH = no such process; EPERM = not permitted but process exists
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "EPERM") {
      return true; // process exists but we can't signal it
    }
    return false;
  }
}


/**
 * Attempt atomic lock file creation via O_CREAT | O_EXCL.
 * Returns true on success, false if the file already exists (EEXIST), throws
 * on any other OS error.
 */
function tryAtomicCreate(lockPath: string, data: string): boolean {
  let fd: number;
  try {
    fd = openSync(lockPath, O_CREAT | O_EXCL | O_WRONLY, 0o644);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Handle an existing lock file: reclaim if stale (dead PID + age > 1h),
 * throw LOCK-001 if held by a live process, throw LOCK-002 if malformed and too recent.
 *
 * Returns true if the stale lock was reclaimed and the caller should retry.
 */
function handleExistingLock(lockPath: string): boolean {
  let parsed: LockInfo | null = null;
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const obj = JSON.parse(raw) as LockInfo;
    if (typeof obj.pid === "number" && typeof obj.acquiredAt === "string") {
      parsed = obj;
    }
  } catch (_parseErr) {
    // Malformed JSON — fall through to age check below
  }

  if (parsed !== null) {
    const pidAlive = isProcessRunning(parsed.pid);

    if (pidAlive) {
      throw SidjuaError.from(
        "LOCK-001",
        `Lock held by PID ${parsed.pid} (acquired ${parsed.acquiredAt}, operation: ${parsed.operation}). ` +
        `PID is alive. Use --force-unlock only if the owning process has truly crashed.`,
      );
    }

    // PID is dead — check age
    const ageMs = Date.now() - new Date(parsed.acquiredAt).getTime();
    if (ageMs <= STALE_LOCK_AGE_MS) {
      // Dead PID but young lock — could be a race or reused PID; refuse to reclaim
      throw SidjuaError.from(
        "LOCK-001",
        `Lock held by PID ${parsed.pid} (acquired ${parsed.acquiredAt}, operation: ${parsed.operation}). ` +
        `PID appears dead but lock is only ${Math.floor(ageMs / 1000)}s old — not reclaiming automatically. ` +
        `Stale locks are reclaimed after ${STALE_LOCK_AGE_MS / 1000}s with dead PID.`,
      );
    }

    // Dead PID AND old enough — reclaim
    logger.warn("lock-manager", "Reclaiming stale lock", {
      metadata: { pid: parsed.pid, ageMs, operation: parsed.operation },
    });
    unlinkSync(lockPath);
    return true; // caller should retry atomic create
  }

  // Malformed lock file — check age via mtime
  const ageMs = Date.now() - statSync(lockPath).mtimeMs;
  if (ageMs <= STALE_LOCK_AGE_MS) {
    throw SidjuaError.from(
      "LOCK-002",
      `Malformed lock file at ${lockPath} — too recent to reclaim (${Math.floor(ageMs / 1000)}s old, threshold: ${STALE_LOCK_AGE_MS / 1000}s). ` +
      `Remove it manually if no operation is running.`,
    );
  }

  logger.warn("lock-manager", "Reclaiming malformed stale lock file", { metadata: { ageMs } });
  unlinkSync(lockPath);
  return true; // caller should retry
}


/**
 * File-based lock manager. One instance per lock file path.
 */
export class FileLockManager {
  private readonly lockPath: string;

  constructor(dataDir: string) {
    this.lockPath = join(dataDir, "sidjua.lock");
  }

  /**
   * Attempt to acquire the lock for the given operation.
   * Uses O_CREAT | O_EXCL for atomic acquisition.
   * Returns true if acquired, throws SidjuaError(LOCK-001/002) if locked.
   */
  async acquire(operation = "update"): Promise<boolean> {
    const info: LockInfo = {
      pid:        process.pid,
      hostname:   hostname(),
      acquiredAt: new Date().toISOString(),
      operation,
    };
    const data = JSON.stringify(info, null, 2);

    const dir = dirname(this.lockPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Retry once after reclaiming a stale lock
    for (let attempt = 0; attempt < 2; attempt++) {
      const created = tryAtomicCreate(this.lockPath, data);
      if (created) {
        logger.info("lock-manager", `Lock acquired for operation '${operation}'`);
        return true;
      }
      // File exists — handle it (may throw or reclaim and return true)
      const reclaimed = handleExistingLock(this.lockPath);
      if (!reclaimed) break; // handleExistingLock threw or reclaimed — loop handles retry
    }

    // Should not reach here (handleExistingLock either throws or reclaims)
    return false;
  }

  /**
   * Release the lock. Only releases if currently held by this process.
   */
  async release(): Promise<void> {
    const existing = await this.getLockInfo();
    if (existing === null) return;

    if (existing.pid !== process.pid) {
      logger.warn("lock-manager", `Cannot release lock held by pid ${existing.pid} (we are ${process.pid})`);
      return;
    }

    if (existsSync(this.lockPath)) {
      unlinkSync(this.lockPath);
    }
    logger.info("lock-manager", "Lock released");
  }

  /**
   * Check whether the lock file exists and the owning process is alive.
   */
  async isLocked(): Promise<boolean> {
    const info = await this.getLockInfo();
    if (info === null) return false;
    return isProcessRunning(info.pid);
  }

  /**
   * Read the lock file. Returns null if it doesn't exist or is malformed.
   */
  async getLockInfo(): Promise<LockInfo | null> {
    if (!existsSync(this.lockPath)) return null;

    try {
      const raw = readFileSync(this.lockPath, "utf-8");
      const parsed = JSON.parse(raw) as LockInfo;
      if (typeof parsed.pid !== "number" || typeof parsed.acquiredAt !== "string") {
        return null;
      }
      return parsed;
    } catch (e: unknown) {
      logger.warn("lock-manager", "Failed to parse lock file — treating as absent", {
        error: { code: "PARSE_ERROR", message: e instanceof Error ? e.message : String(e) },
      });
      return null;
    }
  }

  /**
   * Remove the lock file unconditionally (for --force-unlock).
   */
  async forceRelease(): Promise<void> {
    try {
      if (existsSync(this.lockPath)) {
        unlinkSync(this.lockPath);
        logger.info("lock-manager", "Lock force-released");
      }
    } catch (e: unknown) {
      logger.warn("lock-manager", "Failed to force-release lock", {
        error: { code: "UNLINK_ERROR", message: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  /** Returns the lock file path (for diagnostics). */
  getLockPath(): string { return this.lockPath; }

  /** Returns mtime of lock file in ms, or null if it doesn't exist. */
  getLockAge(): number | null {
    try {
      return existsSync(this.lockPath) ? Date.now() - statSync(this.lockPath).mtimeMs : null;
    } catch (e: unknown) {
      logger.debug("lock-manager", "Could not stat lock file for age — returning null", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return null;
    }
  }
}
