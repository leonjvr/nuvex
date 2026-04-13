// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua selftest` / `sidjua doctor` CLI Command
 *
 * Comprehensive system health check for IT admins, the IT Bootstrap Agent,
 * and cron-based monitoring. Runs a battery of checks across workspace,
 * provider, agent, governance, resource, docker, and dependency categories.
 *
 * Usage:
 *   sidjua selftest                     — human-readable report
 *   sidjua selftest --json              — JSON SelftestReport, exit code based on health
 *   sidjua selftest --fix               — auto-repair fixable failures, then re-check
 *   sidjua selftest --verbose           — show details for each check
 *   sidjua selftest --category workspace,provider
 *   sidjua doctor                       — alias for selftest
 *
 * Exit codes:
 *   0: health score >= 80
 *   1: health score < 80 or any critical failure
 *   2: selftest could not run (invalid work-dir, etc.)
 */

import type { Command }          from "commander";
import { createDefaultRunner }   from "../../core/selftest/index.js";
import type { SelftestReport, CheckResult } from "../../core/selftest/index.js";


export function registerSelftestCommands(program: Command): void {
  const configure = (cmd: ReturnType<typeof program.command>) =>
    cmd
      .description("Comprehensive system health check")
      .option("--json",               "Output full SelftestReport as JSON")
      .option("--fix",                "Attempt auto-repair for fixable failures")
      .option("--verbose",            "Show details for each check")
      .option("--category <cats>",    "Comma-separated categories: workspace,provider,agent,governance,resource,docker,dependency")
      .option("--work-dir <path>",    "Workspace directory", process.cwd())
      .action(runSelftest);

  configure(program.command("selftest"));
  configure(program.command("doctor"));   // alias
}


async function runSelftest(opts: {
  json?:     boolean;
  fix?:      boolean;
  verbose?:  boolean;
  category?: string;
  workDir:   string;
}): Promise<void> {
  const categories = opts.category
    ? opts.category.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const runner = createDefaultRunner(categories);

  let report: SelftestReport;
  try {
    report = await runner.run({
      workDir: opts.workDir,
      verbose: opts.verbose ?? false,
      fix:     opts.fix     ?? false,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Error: selftest could not run — ${msg}\n`);
    process.exit(2);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printReport(report, opts.verbose ?? false);
  }

  process.exit(report.healthScore >= 80 ? 0 : 1);
}


function printReport(report: SelftestReport, verbose: boolean): void {
  const w = (s: string) => process.stdout.write(s);

  w(`\nSIDJUA System Health Check\n`);
  w(`==========================\n\n`);

  // Group checks by category
  const byCategory = new Map<string, CheckResult[]>();
  for (const check of report.checks) {
    const existing = byCategory.get(check.category);
    if (existing === undefined) {
      byCategory.set(check.category, [check]);
    } else {
      existing.push(check);
    }
  }

  const ICON: Record<string, string> = { pass: "✓", warn: "⚠", fail: "✗", skip: "—" };

  for (const [category, checks] of byCategory) {
    w(`${capitalize(category)}\n`);
    for (const c of checks) {
      const icon = ICON[c.status] ?? "?";
      w(`  ${icon} ${c.message}\n`);
      if (c.status === "fail" && c.fixAction !== undefined) {
        w(`    → Fix: ${c.fixAction}\n`);
      } else if (c.status === "warn" && c.fixAction !== undefined) {
        w(`    → Hint: ${c.fixAction}\n`);
      }
      if (verbose && c.details !== undefined) {
        w(`    [detail] ${c.details}\n`);
      }
    }
    w("\n");
  }

  w(`Health Score: ${report.healthScore}/100\n`);
  w(`${report.summary.passed} passed, ${report.summary.warned} warning(s), ${report.summary.failed} failed, ${report.summary.skipped} skipped\n`);

  if (report.recommendations.length > 0) {
    w(`\nRecommendations:\n`);
    for (let i = 0; i < report.recommendations.length; i++) {
      w(`  ${i + 1}. ${report.recommendations[i]}\n`);
    }
  }

  w("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
