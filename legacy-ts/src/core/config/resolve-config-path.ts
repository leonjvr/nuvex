// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Shared config path resolver used by all CLI commands.
 *
 * Resolution order (first found wins):
 *   1. explicit — caller-supplied explicit path
 *   2. {workDir}/governance/divisions/ — directory mode
 *   3. {workDir}/governance/divisions.yaml — single-file mode
 *   4. {workDir}/divisions.yaml — legacy fallback
 */

import { existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Resolve the path to the divisions config file or directory.
 *
 * @param workDir  - Workspace root directory
 * @param explicit - Explicit path (CLI --config flag); may be relative
 * @returns Absolute path to the config file or directory
 * @throws Error if no config found at any of the resolution locations
 */
export function resolveConfigPath(workDir: string, explicit?: string): string {
  if (explicit !== undefined) {
    const abs = resolve(workDir, explicit);
    if (existsSync(abs)) return abs;
    // Explicit path given but not found — still return it so callers give a clear error
    return abs;
  }

  const govDir  = join(workDir, "governance", "divisions");
  const govYaml = join(workDir, "governance", "divisions.yaml");
  const rootYaml = join(workDir, "divisions.yaml");

  if (existsSync(govDir) && statSync(govDir).isDirectory()) return govDir;
  if (existsSync(govYaml)) return govYaml;
  if (existsSync(rootYaml)) return rootYaml;

  throw new Error(
    `No SIDJUA config found. Checked:\n` +
    `  ${govDir}\n  ${govYaml}\n  ${rootYaml}\n` +
    `Run: sidjua apply --config <path>`,
  );
}
