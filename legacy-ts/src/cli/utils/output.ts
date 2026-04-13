// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CLI output formatting utility.
 *
 * Centralises the "print as JSON or human-readable" pattern that was
 * duplicated across CLI commands.  Full migration of all commands to this
 * helper is V1.0 scope; this module establishes the pattern.
 */

import { formatJson } from "../formatters/json.js";

/**
 * Write CLI output to stdout as pretty-printed JSON when `opts.json` is set.
 *
 * The caller is responsible for human-readable rendering when `opts.json` is
 * false; this function is a no-op in that case.
 *
 * @param data - Data to serialise and print.
 * @param opts - CLI option bag; only the `json` field is inspected.
 * @returns    `true` when JSON was emitted, `false` when human mode is active.
 */
export function writeJsonOutput(data: unknown, opts: { json?: boolean }): boolean {
  if (opts.json) {
    process.stdout.write(formatJson(data) + "\n");
    return true;
  }
  return false;
}
