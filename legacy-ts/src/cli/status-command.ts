// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua status` command handler
 *
 * Reads .system/state.json and prints a human-readable summary of the
 * most recent `sidjua apply` run.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { StateFile } from "../types/apply.js";
import { printStatus } from "./output.js";


export interface StatusCommandOptions {
  workDir: string;
}


/**
 * Execute `sidjua status`.
 *
 * @returns Exit code: 0 if state.json was found and displayed,
 *          1 if not found or unreadable.
 *          The caller (index.ts) is responsible for calling process.exit().
 */
export function runStatusCommand(opts: StatusCommandOptions): number {
  const statePath = join(resolve(opts.workDir), ".system", "state.json");

  if (!existsSync(statePath)) {
    process.stdout.write("No state found. Run 'sidjua apply' first.\n");
    return 1;
  }

  try {
    const raw = readFileSync(statePath, "utf-8");
    const state = JSON.parse(raw) as StateFile;
    printStatus(state);
    return 0;
  } catch (err) {
    process.stderr.write(
      `Error reading state: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}
