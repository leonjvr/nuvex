// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua version` Command
 *
 * Shows comprehensive version information:
 *   SIDJUA vX.Y.Z
 *   Governance Ruleset: X.Y (N rules)
 *   Schema Version: N
 *   Node.js: vX.Y.Z
 *   Data Directory: /path/to/data
 *   System Directory: /path/to/system
 */

import type { Command }          from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join }                  from "node:path";
import { getPaths }              from "../../core/paths.js";
import { loadMigrationState }    from "../../core/update/migration-framework.js";
import { loadVersionInfo }       from "../../core/governance/rule-loader.js";
import { SIDJUA_VERSION }        from "../../version.js";
import { msg }                  from "../../i18n/index.js";


export function registerVersionCommands(program: Command): void {
  program
    .command("version")
    .description("Show comprehensive version information")
    .option("--json", "Output in JSON format")
    .action((opts: { json: boolean }) => {
      const paths       = getPaths();
      const govInfo     = loadVersionInfo(paths.system.governance);
      const migState    = loadMigrationState(paths.data.root);

      const rulesetVersion  = govInfo?.ruleset_version ?? "unknown";
      const rulesCount      = govInfo?.rules_count ?? 0;
      const schemaVersion   = migState.schemaVersion;

      if (opts.json) {
        const output = {
          sidjua_version:            SIDJUA_VERSION,
          governance_ruleset:        rulesetVersion,
          governance_rules_count:    rulesCount,
          schema_version:            schemaVersion,
          node_version:              process.version,
          data_directory:            paths.data.root,
          system_directory:          paths.system.root,
        };
        process.stdout.write(JSON.stringify(output, null, 2) + "\n");
        process.exit(0);
      }

      process.stdout.write(`SIDJUA Free v${SIDJUA_VERSION} — ${msg("cli.tagline")}\n`);
      process.stdout.write(`${msg("cli.licenseBanner")}\n\n`);
      process.stdout.write(`Governance Ruleset: ${rulesetVersion} (${rulesCount} rules)\n`);
      process.stdout.write(`Schema Version: ${schemaVersion}\n`);
      process.stdout.write(`Node.js: ${process.version}\n`);
      process.stdout.write(`Data Directory: ${paths.data.root}\n`);
      process.stdout.write(`System Directory: ${paths.system.root}\n`);

      process.exit(0);
    });
}
