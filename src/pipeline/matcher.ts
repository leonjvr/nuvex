// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Action pattern matcher
 *
 * Matches an action type string against a rule pattern.
 * Used by Forbidden, Approval, and Policy stages.
 *
 * Supported patterns:
 *   "*"         — matches all action types
 *   "data.*"    — matches any action starting with "data."
 *   "email.send" — exact match
 */

/**
 * Return true if `actionType` matches `pattern`.
 *
 * Pattern forms:
 * - `"*"` → matches everything
 * - `"data.*"` → prefix glob: matches `"data.delete"`, `"data.export"`, etc.
 * - `"email.send"` → exact match only
 */
export function matchAction(actionType: string, pattern: string): boolean {
  if (pattern === "*") return true;

  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    // Also match underscore-separated variants (e.g. "shell.*" matches "shell_exec")
    return actionType.startsWith(prefix + ".") || actionType.startsWith(prefix + "_");
  }

  return actionType === pattern;
}
