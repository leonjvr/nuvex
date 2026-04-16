// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Secure Temporary Directory Utility
 *
 * Creates temporary directories with unpredictable names and
 * restrictive 0o700 permissions (owner read/write/execute only).
 *
 * Prefer this over ad-hoc mkdtempSync calls to avoid predictable
 * tmp paths and world-readable temp directories.
 */

import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { join }                           from "node:path";
import { tmpdir }                         from "node:os";

/**
 * Create a secure temporary directory.
 *
 * @param prefix  Short label embedded in the directory name (e.g. "backup", "extract").
 *                Must match /^[a-z0-9-]+$/.
 * @returns       Absolute path to the created directory (mode 0o700).
 */
export function createSecureTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `sidjua-${prefix}-`));
  // Ensure restrictive permissions even if umask is permissive.
  chmodSync(dir, 0o700);
  return dir;
}

/**
 * Remove a temporary directory created by createSecureTempDir.
 * Safe to call even if the directory does not exist (no-op).
 *
 * @param dir  Path returned by createSecureTempDir.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_e: unknown) {
    // Best-effort cleanup — callers may use finally blocks but should
    // not let cleanup failures mask the original error.
  }
}
