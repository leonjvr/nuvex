// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Secure File Write Utility
 *
 * Wraps writeFileSync with explicit permission modes to ensure sensitive
 * files are not created world-readable due to a permissive umask.
 *
 * Recommended modes:
 *   0o600 — owner read/write only          (key files, secrets, credentials)
 *   0o644 — owner read/write, group/world read (config files, manifests)
 *   0o700 — owner full, no group/world     (directories holding sensitive data)
 */

import { writeFileSync, chmodSync, existsSync, statSync } from "node:fs";
import { createLogger } from "../core/logger.js";

const logger = createLogger("secure-file");

/** Maximum permissions allowed for a key file before a warning is emitted. */
const MAX_KEY_MODE = 0o600;

/**
 * Write `data` to `path` with explicit permission `mode`.
 *
 * On POSIX systems, the mode is applied atomically via the `writeFileSync`
 * `mode` option.  On Windows (not a supported production platform for V1)
 * the mode argument is silently ignored by Node.js.
 *
 * @param path  Absolute path to the file.
 * @param data  String content to write (UTF-8).
 * @param mode  POSIX permission bits.  Default 0o600 (key files).
 */
export function writeSecureFile(path: string, data: string, mode = 0o600): void {
  writeFileSync(path, data, { encoding: "utf-8", mode });
}

/**
 * Warn if a key file has permissions more permissive than 0o600.
 *
 * Call on startup when reading an existing key to detect files whose
 * permissions were widened by an external tool or a manual `chmod`.
 *
 * @param path  Path to the file to inspect.
 */
export function warnIfPermissiveKeyFile(path: string): void {
  if (!existsSync(path)) return;
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode > MAX_KEY_MODE) {
      logger.warn(
        "permissive_key_file",
        `Key file has overly permissive permissions (${mode.toString(8)}): ${path}`,
        { metadata: { path, mode: mode.toString(8), expected: MAX_KEY_MODE.toString(8) } },
      );
    }
  } catch (_e: unknown) {
    // Best-effort — non-fatal if stat fails (e.g. race with deletion).
  }
}
