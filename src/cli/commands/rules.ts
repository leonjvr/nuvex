// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua rules` CLI Command
 *
 * Inspect active governance rules (system baseline + user extensions).
 *
 *   sidjua rules            — list ALL active rules (system + user), grouped
 *   sidjua rules --system   — list only system (mandatory) rules
 *   sidjua rules --user     — list only user-defined rules
 *   sidjua rules --version  — show governance ruleset version info
 *   sidjua rules --validate — check for conflicts between system and user rules
 */

import type { Command }   from "commander";
import { resolvePaths }   from "../../core/paths.js";
import {
  loadGovernanceRuleset,
  loadVersionInfo,
  type GovernanceRule,
}                         from "../../core/governance/rule-loader.js";


/**
 * Register the `sidjua rules` command on the given Commander program.
 */
export function registerRulesCommands(program: Command): void {
  program
    .command("rules")
    .description("List active governance rules (system baseline + user extensions)")
    .option("--system",        "List only system (mandatory) rules")
    .option("--user",          "List only user-defined rules")
    .option("--version",       "Show governance ruleset version info")
    .option("--validate",      "Check for conflicts between system and user rules")
    .option("--json",          "Output in JSON format")
    .option("--work-dir <path>", "Data directory (default: auto-detected)", process.cwd())
    .action((opts: {
      system:   boolean;
      user:     boolean;
      version:  boolean;
      validate: boolean;
      json:     boolean;
      workDir:  string;
    }) => {
      const paths   = resolvePaths(opts.workDir);
      const ruleset = loadGovernanceRuleset(paths.system.governance, paths.data.governance);

      // ── --version ──────────────────────────────────────────────────────────
      if (opts.version) {
        const info = loadVersionInfo(paths.system.governance);

        if (opts.json) {
          process.stdout.write(JSON.stringify(info ?? { ruleset_version: ruleset.rulesetVersion }) + "\n");
          process.exit(0);
        }

        if (info !== null) {
          const until = info.compatible_sidjua_max === "0.x.x" ? "0.x.x (current series)" : info.compatible_sidjua_max;
          process.stdout.write(`Governance Ruleset Version: ${info.ruleset_version}\n`);
          process.stdout.write(`Compatible SIDJUA versions: ${info.compatible_sidjua_min} — ${until}\n`);
          process.stdout.write(`Released: ${info.released.slice(0, 10)}\n`);
          process.stdout.write(`Rules count: ${info.rules_count} system rules\n`);
          if (info.changelog) {
            process.stdout.write(`Changelog: ${info.changelog}\n`);
          }
        } else {
          process.stdout.write(`Governance Ruleset Version: ${ruleset.rulesetVersion}\n`);
        }
        process.exit(0);
      }

      // ── --validate ─────────────────────────────────────────────────────────
      if (opts.validate) {
        if (opts.json) {
          process.stdout.write(JSON.stringify({
            system_rules: ruleset.systemRules.length,
            user_rules:   ruleset.userRules.length,
            conflicts:    ruleset.conflicts.length,
            conflict_details: ruleset.conflicts.map((c) => ({
              system_rule_id: c.systemRule.id,
              user_rule_id:   c.userRule.id,
              reason:         c.reason,
            })),
          }) + "\n");
          process.exit(0);
        }

        process.stdout.write("Validating governance rules...\n\n");
        process.stdout.write(`System rules: ${ruleset.systemRules.length} loaded\n`);
        process.stdout.write(`User rules: ${ruleset.userRules.length + ruleset.conflicts.length} loaded\n`);
        process.stdout.write(`Conflicts: ${ruleset.conflicts.length}\n`);

        if (ruleset.conflicts.length === 0) {
          process.stdout.write("\nAll rules valid. No conflicts detected.\n");
        } else {
          process.stdout.write("\n");
          for (const conflict of ruleset.conflicts) {
            process.stdout.write(`CONFLICT: User rule ${conflict.userRule.id} (id: ${conflict.systemRule.id})\n`);
            process.stdout.write(`  Reason: ${conflict.reason}\n`);
            process.stdout.write(`  Action: User rule ignored, system rule takes precedence\n\n`);
          }
          process.stdout.write(`Valid rules: ${ruleset.mergedRules.length} (${ruleset.systemRules.length} system + ${ruleset.userRules.length} user)\n`);
          process.stdout.write(`Ignored: ${ruleset.conflicts.length} (conflicts)\n`);
        }
        process.exit(0);
      }

      // ── Default / --system / --user ────────────────────────────────────────
      let rules: GovernanceRule[];
      if (opts.system) {
        rules = ruleset.systemRules;
      } else if (opts.user) {
        rules = ruleset.userRules;
      } else {
        rules = ruleset.mergedRules;
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(rules, null, 2) + "\n");
        process.exit(0);
      }

      // Human-readable output
      process.stdout.write(`SIDJUA Governance Rules (Ruleset ${ruleset.rulesetVersion})\n\n`);

      if (!opts.user) {
        process.stdout.write(`=== System Rules (mandatory, ${ruleset.systemRules.length} rules) ===\n`);
        for (const rule of ruleset.systemRules) {
          process.stdout.write(`  ${formatSeverity(rule.severity)} ${rule.id.padEnd(16)} ${rule.name}\n`);
        }
        if (!opts.system) process.stdout.write("\n");
      }

      if (!opts.system && ruleset.userRules.length > 0) {
        process.stdout.write(`=== User Rules (${ruleset.userRules.length} rules) ===\n`);
        for (const rule of ruleset.userRules) {
          process.stdout.write(`  ${formatSeverity(rule.severity)} ${rule.id.padEnd(16)} ${rule.name}\n`);
        }
      } else if (!opts.system && ruleset.userRules.length === 0) {
        process.stdout.write(`=== User Rules (0 rules) ===\n`);
        process.stdout.write(`  (no user governance rules configured)\n`);
      }

      if (!opts.system && !opts.user) {
        process.stdout.write(`\nTotal: ${ruleset.mergedRules.length} rules active `);
        process.stdout.write(`(${ruleset.systemRules.length} system + ${ruleset.userRules.length} user)\n`);
      }

      process.exit(0);
    });
}


function formatSeverity(severity: string): string {
  switch (severity) {
    case "critical": return "[CRIT]";
    case "high":     return "[HIGH]";
    case "medium":   return "[MED ]";
    case "low":      return "[LOW ]";
    default:         return "[    ]";
  }
}
