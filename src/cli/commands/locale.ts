// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua locale` Command (P190)
 *
 * Show and change the active locale for the current workspace.
 *
 * Subcommands:
 *   sidjua locale             — Show current locale
 *   sidjua locale set <code>  — Persist locale to DB
 *   sidjua locale list        — List available locales with completion %
 */

import { existsSync }  from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { t }           from "../../i18n/index.js";
import {
  getLocale,
  setLocale,
  getAvailableLocales,
  loadLocaleData,
} from "../../i18n/index.js";
import { openDatabase } from "../../utils/db.js";
import { runWorkspaceConfigMigration } from "../../api/workspace-config-migration.js";


export function registerLocaleCommands(program: Command): void {
  const localeCmd = program
    .command("locale")
    .description("Show or change the workspace display language")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action((opts: { workDir: string }) => {
      const locale = getLocale();
      process.stdout.write(t("cli.locale.current", { locale }) + "\n");
      void opts;
    });

  localeCmd
    .command("set <code>")
    .description("Set the locale (e.g. de, en)")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (code: string, opts: { workDir: string }) => {
      const workDir   = resolve(opts.workDir);
      const available = getAvailableLocales();

      if (!available.includes(code)) {
        process.stderr.write(t("cli.locale.unknown", { locale: code }));
        process.exit(1);
      }

      // Persist to SQLite workspace_config
      const dbPath = join(workDir, ".system", "sidjua.db");
      if (!existsSync(dbPath)) {
        process.stderr.write(t("cli.locale.no_workspace"));
        process.exit(1);
      }

      const db = openDatabase(dbPath);
      runWorkspaceConfigMigration(db);
      db.prepare(
        "INSERT OR REPLACE INTO workspace_config (key, value, updated_at) VALUES ('locale', ?, datetime('now'))",
      ).run(code);
      db.close();

      setLocale(code);
      process.stdout.write(t("cli.locale.set_success", { locale: code }));
    });

  localeCmd
    .command("list")
    .description("List available locales with translation completion")
    .action(() => {
      const available = getAvailableLocales();
      const enData    = loadLocaleData("en");
      const totalKeys = Object.keys(enData).filter((k) => !k.startsWith("_")).length;

      process.stdout.write(t("cli.locale.available_header") + "\n");

      for (const locale of available) {
        if (locale === "en") {
          process.stdout.write(t("cli.locale.locale_en", { locale }) + "\n");
          continue;
        }
        // Count non-empty translated keys (excluding _meta keys)
        const locData    = loadLocaleData(locale);
        const translated = Object.entries(locData)
          .filter(([k, v]) => !k.startsWith("_") && v !== "")
          .length;
        // Subtract English base (deep-merged) — count only locale-specific overrides
        // Simple heuristic: percentage of non-empty own-locale entries vs total
        const completion = totalKeys > 0 ? Math.round((translated / totalKeys) * 100) : 0;
        if (completion >= 100) {
          process.stdout.write(t("cli.locale.locale_full", { locale }) + "\n");
        } else {
          process.stdout.write(t("cli.locale.locale_partial", { locale, completion: String(completion) }) + "\n");
        }
      }
    });
}
