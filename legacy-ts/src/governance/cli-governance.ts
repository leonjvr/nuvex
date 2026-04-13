// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.8: Governance CLI Commands
 *
 * Registers `sidjua governance` sub-commands on a Commander program.
 *
 *   sidjua governance history               — list snapshots
 *   sidjua governance rollback <version>    — restore a snapshot
 *   sidjua governance diff <version>        — show diff vs snapshot
 */

import type { Command } from "commander";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import {
  listSnapshots,
  loadSnapshot,
  restoreSnapshot,
  diffSnapshot,
} from "./rollback.js";
import { readYamlFile } from "../pipeline/config-loader.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("cli-governance");


/**
 * Register `sidjua governance` sub-commands on the given Commander program.
 */
export function registerGovernanceCommands(program: Command): void {
  const gov = program
    .command("governance")
    .description("Governance snapshot management");

  // ── sidjua governance history ─────────────────────────────────────────────

  gov
    .command("history")
    .description("List governance snapshots (most recent first)")
    .option("--json", "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action((opts: { json: boolean; workDir: string }) => {
      const snapshots = listSnapshots(opts.workDir);

      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            snapshots.map((s) => ({
              version:             s.version,
              timestamp:           s.timestamp,
              trigger:             s.trigger,
              divisions_yaml_hash: s.divisions_yaml_hash,
              file_count:          s.files.length,
            })),
            null,
            2,
          ) + "\n",
        );
        process.exit(0);
      }

      if (snapshots.length === 0) {
        process.stdout.write("No governance snapshots found.\n");
        process.exit(0);
      }

      process.stdout.write("Governance snapshot history:\n");
      process.stdout.write("─".repeat(70) + "\n");

      for (const s of snapshots) {
        const date = new Date(s.timestamp).toLocaleString();
        process.stdout.write(
          `v${String(s.version).padEnd(4)} ${date}  trigger=${s.trigger}  files=${s.files.length}  hash=${s.divisions_yaml_hash.slice(0, 8)}...\n`,
        );
      }

      process.exit(0);
    });

  // ── sidjua governance rollback ────────────────────────────────────────────

  gov
    .command("rollback <version>")
    .description("Restore governance state to a specific snapshot version")
    .option("--work-dir <path>",  "Working directory",       process.cwd())
    .option("--config <path>",    "Path to divisions.yaml",  "./divisions.yaml")
    .option("--force",            "Skip confirmation prompt", false)
    .action(async (versionStr: string, opts: {
      workDir: string;
      config:  string;
      force:   boolean;
    }) => {
      const version = parseInt(versionStr, 10);
      if (isNaN(version) || version < 1) {
        process.stderr.write(`Error: invalid version "${versionStr}". Must be a positive integer.\n`);
        process.exit(1);
      }

      const snapshot = loadSnapshot(opts.workDir, version);
      if (snapshot === null) {
        process.stderr.write(`Error: snapshot v${version} not found.\n`);
        process.exit(1);
      }

      if (!opts.force) {
        process.stdout.write(`Rollback to governance snapshot v${version} (${snapshot.timestamp})\n`);
        process.stdout.write(`This will overwrite ${snapshot.files.length} governance file(s).\n`);
        process.stdout.write("Run with --force to proceed without confirmation.\n");
        process.exit(0);
      }

      try {
        restoreSnapshot(opts.workDir, snapshot, null);
        process.stdout.write(`Governance rolled back to v${version} successfully.\n`);
        process.stdout.write("Run 'sidjua apply' to reload the restored configuration.\n");
        process.exit(0);
      } catch (err) {
        process.stderr.write(
          `Error: rollback failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      }
    });

  // ── sidjua governance diff ────────────────────────────────────────────────

  gov
    .command("diff <version>")
    .description("Show what changed between current state and a snapshot")
    .option("--work-dir <path>", "Working directory",      process.cwd())
    .option("--config <path>",   "Path to divisions.yaml", "./divisions.yaml")
    .option("--json",            "Output in JSON format",  false)
    .action((versionStr: string, opts: {
      workDir: string;
      config:  string;
      json:    boolean;
    }) => {
      const version = parseInt(versionStr, 10);
      if (isNaN(version) || version < 1) {
        process.stderr.write(`Error: invalid version "${versionStr}".\n`);
        process.exit(1);
      }

      const snapshot = loadSnapshot(opts.workDir, version);
      if (snapshot === null) {
        process.stderr.write(`Error: snapshot v${version} not found.\n`);
        process.exit(1);
      }

      const configPath = opts.config.startsWith("/")
        ? opts.config
        : join(opts.workDir, opts.config);

      const diff = diffSnapshot(opts.workDir, snapshot, configPath);

      if (opts.json) {
        process.stdout.write(JSON.stringify(diff, null, 2) + "\n");
        process.exit(0);
      }

      process.stdout.write(`Diff: current  ↔  snapshot v${version} (${snapshot.timestamp})\n`);
      process.stdout.write("─".repeat(70) + "\n");

      if (diff.yaml_hash_match) {
        process.stdout.write("  divisions.yaml : unchanged\n");
      } else {
        process.stdout.write("  divisions.yaml : CHANGED\n");
      }

      if (diff.changed_files.length === 0) {
        process.stdout.write("  All governance files : unchanged\n");
      } else {
        for (const f of diff.changed_files) {
          const symbol = f.status === "removed" ? "-" : "~";
          process.stdout.write(`  ${symbol} ${f.path}\n`);
        }
      }

      process.exit(0);
    });

  // ── sidjua governance security-mode ───────────────────────────────────────

  gov
    .command("security-mode [mode]")
    .description("Get or set the security filter mode (blacklist | whitelist)")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .option("--json",            "Output in JSON format", false)
    .action((modeArg: string | undefined, opts: { workDir: string; json: boolean }) => {
      const securityYamlPath = join(opts.workDir, "governance", "security", "security.yaml");

      // ── READ mode (no argument given) ─────────────────────────────────────
      if (modeArg === undefined) {
        if (!existsSync(securityYamlPath)) {
          if (opts.json) {
            process.stdout.write(JSON.stringify({ mode: "blacklist", configured: false }) + "\n");
          } else {
            process.stdout.write("Security filter mode: blacklist (default — no security.yaml found)\n");
          }
          process.exit(0);
        }

        let mode = "blacklist";
        try {
          const raw = readYamlFile(securityYamlPath) as { filter?: { mode?: string } } | null;
          mode = raw?.filter?.mode ?? "blacklist";
        } catch (err) {
          process.stderr.write(
            `Error reading security.yaml: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(1);
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify({ mode, configured: true }) + "\n");
        } else {
          process.stdout.write(`Security filter mode: ${mode}\n`);
        }
        process.exit(0);
      }

      // ── WRITE mode (argument given) ────────────────────────────────────────
      if (modeArg !== "blacklist" && modeArg !== "whitelist") {
        process.stderr.write(
          `Error: invalid mode "${modeArg}". Must be "blacklist" or "whitelist".\n`,
        );
        process.exit(1);
      }

      // Load existing config or start from a safe default
      let existing: Record<string, unknown> = {
        filter: { mode: modeArg, blocked: [], allowed: [], allowed_networks: [] },
      };
      if (existsSync(securityYamlPath)) {
        try {
          const raw = readYamlFile(securityYamlPath) as Record<string, unknown> | null;
          if (raw !== null) existing = raw;
        } catch (e: unknown) {
          logger.debug("cli-governance", "Existing governance config not readable — overwriting with default", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        }
      }

      // Update only the mode field, preserving all other filter settings
      const filter = (existing["filter"] as Record<string, unknown> | undefined) ?? {};
      filter["mode"] = modeArg;
      existing["filter"] = filter;

      // Ensure the security directory exists
      const securityDir = join(opts.workDir, "governance", "security");
      mkdirSync(securityDir, { recursive: true });

      writeFileSync(securityYamlPath, stringifyYaml(existing), "utf-8");

      process.stdout.write(`Security filter mode set to: ${modeArg}\n`);
      process.stdout.write("Run 'sidjua apply' for the change to take effect.\n");
      process.exit(0);
    });
}
