// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.9: Backup CLI Commands
 *
 * Commands:
 *   sidjua backup create [--label <name>] [--output <path>]
 *   sidjua backup list
 *   sidjua backup restore <id-or-path> [--force] [--dry-run]
 *   sidjua backup info <id-or-path>
 *   sidjua backup delete <id> [--force]
 */

import type { Command } from "commander";
import { existsSync }   from "node:fs";
import { join }         from "node:path";
import {
  createBackup,
  restoreBackup,
  listBackups,
  getBackupInfo,
  deleteBackup,
  getBackupConfig,
  type BackupInfo,
} from "../core/backup.js";
import { isSidjuaError } from "../core/error-codes.js";
import { formatBytes }   from "./utils/format.js";

/** Resolve divisions.yaml path: governance/ (new default) → root (legacy). */
function resolveConfigPath(workDir: string, explicit?: string): string {
  if (explicit) return explicit;
  const govPath = join(workDir, "governance", "divisions.yaml");
  return existsSync(govPath) ? govPath : join(workDir, "divisions.yaml");
}


export function registerBackupCommands(program: Command): void {
  const backupCmd = program
    .command("backup")
    .description("Backup and restore SIDJUA workspace");

  // ── create ────────────────────────────────────────────────────────────────
  backupCmd
    .command("create")
    .description("Create a full system backup")
    .option("--label <name>",    "Human-readable label for this backup")
    .option("--output <path>",   "Write archive to this path (overrides config directory)")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--config <path>",   "Path to divisions.yaml")
    .action(async (opts: { label?: string; output?: string; workDir: string; config?: string }) => {
      const workDir    = opts.workDir;
      const configPath = resolveConfigPath(workDir, opts.config);

      process.stdout.write("Creating backup...\n");

      try {
        const result = await createBackup({
          workDir,
          configPath,
          ...(opts.label  !== undefined && { label:      opts.label }),
          ...(opts.output !== undefined && { outputPath: opts.output }),
        });

        process.stdout.write(`\nBackup created successfully.\n`);
        process.stdout.write(`  ID:       ${result.short_id} (${result.id})\n`);
        process.stdout.write(`  Archive:  ${result.archive_path}\n`);
        process.stdout.write(`  Files:    ${result.file_count}\n`);
        process.stdout.write(`  Size:     ${formatBytes(result.archive_size_bytes)}\n`);
        if (result.label) {
          process.stdout.write(`  Label:    ${result.label}\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── list ──────────────────────────────────────────────────────────────────
  backupCmd
    .command("list")
    .description("List all backups")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--config <path>",   "Path to divisions.yaml")
    .action(async (opts: { workDir: string; config?: string }) => {
      const cfg     = getBackupConfig(opts.workDir, opts.config);
      const backups = await listBackups(cfg.directory);

      if (backups.length === 0) {
        process.stdout.write("No backups found.\n");
        process.stdout.write(`Backup directory: ${cfg.directory}\n`);
        return;
      }

      process.stdout.write(
        `${"ID".padEnd(10)} ${"DATE".padEnd(20)} ${"SIZE".padEnd(12)} ${"FILES".padEnd(8)} LABEL\n`,
      );
      process.stdout.write(`${"-".repeat(10)} ${"-".repeat(20)} ${"-".repeat(12)} ${"-".repeat(8)} -----\n`);

      for (const b of backups) {
        const id    = b.short_id.padEnd(10);
        const date  = new Date(b.created_at).toLocaleString().padEnd(20);
        const size  = formatBytes(b.archive_size_bytes).padEnd(12);
        const files = String(b.file_count).padEnd(8);
        const label = b.label ?? "";
        process.stdout.write(`${id} ${date} ${size} ${files} ${label}\n`);
      }
    });

  // ── restore ───────────────────────────────────────────────────────────────
  backupCmd
    .command("restore <id-or-path>")
    .description("Restore from a backup (creates pre-restore safety backup automatically)")
    .option("--force",           "Skip confirmation and agents-running check")
    .option("--dry-run",         "Validate without modifying anything")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--config <path>",   "Path to divisions.yaml")
    .action(async (
      idOrPath: string,
      opts: { force?: boolean; dryRun?: boolean; workDir: string; config?: string },
    ) => {
      const workDir    = opts.workDir;
      const configPath = resolveConfigPath(workDir, opts.config);
      const cfg        = getBackupConfig(workDir, configPath);

      if (opts.dryRun) {
        process.stdout.write("Dry-run mode — no files will be modified.\n");
      } else if (!opts.force) {
        // Show what will be restored, ask for confirmation
        try {
          const manifest = await getBackupInfo(idOrPath, cfg.directory);
          process.stdout.write(`\nAbout to restore backup ${manifest.short_id}:\n`);
          process.stdout.write(`  Created:  ${manifest.created_at}\n`);
          process.stdout.write(`  Files:    ${manifest.file_count}\n`);
          if (manifest.label) {
            process.stdout.write(`  Label:    ${manifest.label}\n`);
          }
          process.stdout.write(`\nA pre-restore backup will be created automatically.\n`);
          process.stdout.write(`Use --force to skip this confirmation.\n`);
          process.exit(0);
        } catch (err) {
          process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
          process.exit(1);
        }
      }

      try {
        process.stdout.write(`${opts.dryRun ? "Validating" : "Restoring"} backup...\n`);

        const result = await restoreBackup({
          archivePathOrId: idOrPath,
          workDir,
          configPath,
          backupDir: cfg.directory,
          ...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
          ...(opts.force  !== undefined && { force:  opts.force }),
        });

        if (result.dryRun) {
          process.stdout.write(`\nDry-run complete. Backup is valid.\n`);
          process.stdout.write(`  Files that would be restored: ${result.files_restored}\n`);
        } else {
          process.stdout.write(`\nRestore complete.\n`);
          process.stdout.write(`  Files restored: ${result.files_restored}\n`);
          if (result.pre_restore_backup_id) {
            process.stdout.write(`  Pre-restore backup: ${result.pre_restore_backup_id.slice(0, 8)}\n`);
          }
          process.stdout.write(`\nRun 'sidjua apply' to reload configuration.\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        if (isSidjuaError(err) && err.suggestion) {
          process.stderr.write(`Hint: ${err.suggestion}\n`);
        }
        process.exit(1);
      }
    });

  // ── info ──────────────────────────────────────────────────────────────────
  backupCmd
    .command("info <id-or-path>")
    .description("Show details of a backup")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--config <path>",   "Path to divisions.yaml")
    .action(async (idOrPath: string, opts: { workDir: string; config?: string }) => {
      const cfg = getBackupConfig(opts.workDir, opts.config);

      try {
        const manifest = await getBackupInfo(idOrPath, cfg.directory);
        process.stdout.write(`Backup: ${manifest.short_id}\n`);
        process.stdout.write(`  Full ID:   ${manifest.id}\n`);
        process.stdout.write(`  Created:   ${manifest.created_at}\n`);
        process.stdout.write(`  Version:   ${manifest.sidjua_version}\n`);
        process.stdout.write(`  Files:     ${manifest.file_count}\n`);
        process.stdout.write(`  Size:      ${formatBytes(manifest.total_size_bytes)} (uncompressed)\n`);
        process.stdout.write(`  Checksum:  ${manifest.checksum.slice(0, 16)}…\n`);
        if (manifest.label) {
          process.stdout.write(`  Label:     ${manifest.label}\n`);
        }
        process.stdout.write(`  Workspace: ${manifest.work_dir}\n`);
        process.stdout.write(`\nFiles included:\n`);
        for (const f of manifest.files.slice(0, 20)) {
          process.stdout.write(`  ${f}\n`);
        }
        if (manifest.files.length > 20) {
          process.stdout.write(`  … and ${manifest.files.length - 20} more\n`);
        }
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });

  // ── delete ────────────────────────────────────────────────────────────────
  backupCmd
    .command("delete <id>")
    .description("Delete a backup archive")
    .option("--force",           "Skip confirmation")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--config <path>",   "Path to divisions.yaml")
    .action(async (id: string, opts: { force?: boolean; workDir: string; config?: string }) => {
      const cfg = getBackupConfig(opts.workDir, opts.config);

      if (!opts.force) {
        process.stdout.write(`Delete backup "${id}"? Use --force to confirm.\n`);
        process.exit(0);
      }

      try {
        deleteBackup(id, cfg.directory);
        process.stdout.write(`Backup "${id}" deleted.\n`);
      } catch (err) {
        process.stderr.write(`Error: ${isSidjuaError(err) ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });
}


