// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.7: Environment CLI commands
 * Registers: sidjua env list/show/test/add
 */

import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { openDatabase } from "../utils/db.js";
import { runToolMigrations } from "./migration.js";
import { EnvironmentManager } from "./environment-manager.js";
import { parse as parseYaml } from "yaml";
import type { EnvironmentConfig } from "./types.js";


/**
 * Register all `sidjua env *` subcommands on the given Commander program.
 */
export function registerEnvCommands(program: Command): void {
  const envCmd = program
    .command("env")
    .description("Manage execution environments");

  // ── sidjua env list ────────────────────────────────────────────────────

  envCmd
    .command("list")
    .description("List all environments")
    .option("--db <path>", "Path to sidjua.db", "./sidjua.db")
    .action((opts: { db: string }) => {
      const db = openDatabase(opts.db);
      try {
        runToolMigrations(db);
        const manager = new EnvironmentManager(db);
        const envs = manager.list();

        if (envs.length === 0) {
          process.stdout.write("No environments registered.\n");
          process.exit(0);
          return;
        }

        // Print table header
        const idW = 36;
        const typeW = 12;
        const platformW = 14;
        const statusW = 10;
        const header =
          "ID".padEnd(idW) +
          " | " +
          "TYPE".padEnd(typeW) +
          " | " +
          "PLATFORM".padEnd(platformW) +
          " | " +
          "STATUS";
        const sep = "─".repeat(header.length);
        process.stdout.write(header + "\n" + sep + "\n");

        for (const env of envs) {
          const row =
            env.id.padEnd(idW) +
            " | " +
            env.type.padEnd(typeW) +
            " | " +
            (env.platform ?? "").padEnd(platformW) +
            " | " +
            env.status;
          process.stdout.write(row + "\n");
        }
        process.exit(0);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ── sidjua env show <id> ───────────────────────────────────────────────

  envCmd
    .command("show <id>")
    .description("Show full details of an environment")
    .option("--db <path>", "Path to sidjua.db", "./sidjua.db")
    .action((id: string, opts: { db: string }) => {
      const db = openDatabase(opts.db);
      try {
        runToolMigrations(db);
        const manager = new EnvironmentManager(db);
        const env = manager.getById(id);

        if (env === undefined) {
          process.stderr.write(`Error: environment '${id}' not found.\n`);
          process.exit(1);
          return;
        }

        process.stdout.write(
          `Environment: ${env.id}\n` +
            `  Name:             ${env.name}\n` +
            `  Type:             ${env.type}\n` +
            `  Platform:         ${env.platform ?? "(none)"}\n` +
            `  Platform version: ${env.platform_version ?? "(none)"}\n` +
            `  Status:           ${env.status}\n` +
            `  Last tested:      ${env.last_tested_at ?? "(never)"}\n` +
            `  Created:          ${env.created_at}\n` +
            `  Updated:          ${env.updated_at}\n` +
            `  Config:\n` +
            `${JSON.stringify(env.config, null, 4)
              .split("\n")
              .map((line) => `    ${line}`)
              .join("\n")}\n`,
        );
        process.exit(0);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ── sidjua env test <id> ───────────────────────────────────────────────

  envCmd
    .command("test <id>")
    .description("Test connectivity to an environment")
    .option("--db <path>", "Path to sidjua.db", "./sidjua.db")
    .action(async (id: string, opts: { db: string }) => {
      const db = openDatabase(opts.db);
      try {
        runToolMigrations(db);
        const manager = new EnvironmentManager(db);
        const result = await manager.testConnectivity(id);

        process.stdout.write(
          `connected: ${String(result.connected)}\n` +
            `latency_ms: ${result.latency_ms}\n` +
            (result.error !== undefined ? `error: ${result.error}\n` : ""),
        );
        process.exit(result.connected ? 0 : 1);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ── sidjua env add ─────────────────────────────────────────────────────

  envCmd
    .command("add")
    .description("Add a new environment from a YAML definition file")
    .requiredOption("--file <yaml-path>", "Path to environment YAML definition file")
    .option("--db <path>", "Path to sidjua.db", "./sidjua.db")
    .action(async (opts: { file: string; db: string }) => {
      const db = openDatabase(opts.db);
      try {
        runToolMigrations(db);

        let raw: string;
        try {
          raw = readFileSync(opts.file, "utf-8");
        } catch (readErr) {
          process.stderr.write(
            `Error: cannot read file '${opts.file}': ${readErr instanceof Error ? readErr.message : String(readErr)}\n`,
          );
          process.exit(1);
          return;
        }

        let config: EnvironmentConfig;
        try {
          const parsed: unknown = parseYaml(raw);
          if (
            parsed === null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
          ) {
            throw new Error("YAML root must be an object");
          }
          config = parsed as EnvironmentConfig;
        } catch (parseErr) {
          process.stderr.write(
            `Error: failed to parse YAML: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n`,
          );
          process.exit(1);
          return;
        }

        const manager = new EnvironmentManager(db);
        const env = await manager.create({
          id: config.id,
          name: config.name,
          type: config.type,
          ...(config.platform !== undefined ? { platform: config.platform } : {}),
          ...(config.platform_version !== undefined
            ? { platform_version: config.platform_version }
            : {}),
          config,
        });

        process.stdout.write(`Environment '${env.id}' created successfully.\n`);
        process.exit(0);
      } catch (err) {
        process.stderr.write(
          `Error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(1);
      } finally {
        db.close();
      }
    });
}
