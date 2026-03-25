// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CLI process utilities
 */

/**
 * Check whether a process is alive by sending signal 0.
 * Returns true if the process exists and is reachable, false otherwise.
 *
 * Error handling:
 *   ESRCH — process does not exist → false
 *   EPERM — process exists but we lack permission to signal it → true
 *   Other — log and return false (conservative, avoids zombie restarts)
 *
 * This is the canonical way to test process existence in Node.js.
 * Use this instead of duplicating the try/catch pattern across CLI commands.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) { // cleanup-ignore: process.kill(pid, 0) throws ESRCH when process is not alive — expected "dead process" signal
    const code = (e as NodeJS.ErrnoException).code; // cleanup-ignore
    if (code === "EPERM") {
      // Process exists — we just lack permission to signal it.
      return true;
    }
    // ESRCH: no such process. Any other error: treat as not alive.
    return false;
  }
}
