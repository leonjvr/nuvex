// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.8: Logging CLI Commands
 *
 * Registers runtime log level management commands on an existing Commander program.
 *
 *   sidjua logging status         — show current log levels for all components
 *   sidjua logging set <c> <lvl>  — change component level at runtime
 *   sidjua logging set --global <lvl> — change global default at runtime
 */

import type { Command } from "commander";
import {
  getLoggerStatus,
  setGlobalLevel,
  setComponentLevel,
  type LogLevel,
} from "../core/logger.js";

const VALID_LEVELS = ["debug", "info", "warn", "error", "fatal", "off"] as const;

function isValidLevel(s: string): s is LogLevel {
  return (VALID_LEVELS as readonly string[]).includes(s);
}


/**
 * Register `sidjua logging` sub-commands on the given Commander program.
 */
export function registerLoggingCommands(program: Command): void {
  const logging = program
    .command("logging")
    .description("Runtime log level management");

  // ── sidjua logging status ─────────────────────────────────────────────────

  logging
    .command("status")
    .description("Show current log levels for all components")
    .option("--json", "Output in JSON format", false)
    .action((opts: { json: boolean }) => {
      const status = getLoggerStatus();

      if (opts.json) {
        process.stdout.write(JSON.stringify(status, null, 2) + "\n");
        process.exit(0);
      }

      process.stdout.write(`Global level : ${status.global}\n`);
      process.stdout.write(`Format       : ${status.format}\n`);
      process.stdout.write(`Output       : ${status.output}\n`);

      const components = Object.entries(status.components);
      if (components.length === 0) {
        process.stdout.write("Components   : (none — all inherit global)\n");
      } else {
        process.stdout.write("Components:\n");
        for (const [comp, lvl] of components.sort()) {
          process.stdout.write(`  ${comp.padEnd(30)} ${lvl}\n`);
        }
      }

      process.exit(0);
    });

  // ── sidjua logging set ────────────────────────────────────────────────────

  logging
    .command("set [component] [level]")
    .description("Change log level for a component (or global) at runtime")
    .option("--global <level>", "Change the global default level")
    .action((component: string | undefined, level: string | undefined, opts: { global?: string }) => {
      // --global flag
      if (opts.global !== undefined) {
        if (!isValidLevel(opts.global)) {
          process.stderr.write(
            `Error: invalid level "${opts.global}". Valid: ${VALID_LEVELS.join(", ")}\n`,
          );
          process.exit(1);
        }
        setGlobalLevel(opts.global);
        process.stdout.write(`Global log level set to: ${opts.global}\n`);
        process.stdout.write("Note: change is ephemeral — edit divisions.yaml + sidjua apply for persistence\n");
        process.exit(0);
      }

      // Component + level
      if (component === undefined || level === undefined) {
        process.stderr.write(
          "Usage: sidjua logging set <component> <level>  or  sidjua logging set --global <level>\n",
        );
        process.exit(1);
      }

      if (!isValidLevel(level)) {
        process.stderr.write(
          `Error: invalid level "${level}". Valid: ${VALID_LEVELS.join(", ")}\n`,
        );
        process.exit(1);
      }

      setComponentLevel(component, level);
      process.stdout.write(`Component "${component}" log level set to: ${level}\n`);
      process.stdout.write("Note: change is ephemeral — edit divisions.yaml + sidjua apply for persistence\n");
      process.exit(0);
    });
}
