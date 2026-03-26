// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Backup REST endpoint
 *
 * POST /api/v1/backup      — create a ZIP archive of the workspace
 * GET  /api/v1/backup/list — list existing backup archives
 *
 * Security constraints:
 *   - master.key is NEVER included in any backup archive
 *   - Max 1 backup per minute (rate-limited per installation)
 *   - Max 10 stored backups — oldest is deleted when the limit is exceeded
 *   - Backups written to {workDir}/backups/ (0o600 perms)
 */

import { Hono }                                           from "hono";
import archiver                                           from "archiver";
import { createWriteStream, existsSync, statSync }        from "node:fs";
import { mkdir, readdir, unlink }                         from "node:fs/promises";
import { join, basename }                                 from "node:path";
import { createLogger }                                   from "../../core/logger.js";
import { requireScope }                                   from "../middleware/require-scope.js";

const logger = createLogger("backup");

/** Maximum stored backup archives before the oldest is pruned. */
const MAX_BACKUPS = 10;
/** Minimum time between successive backup requests (ms). */
const RATE_LIMIT_MS = 60_000;
/** Filename portion of the master key — excluded from all archives. */
const MASTER_KEY_FILENAME = "master.key";

/** Last backup timestamp for rate limiting (per-process). */
let _lastBackupAt = 0;

/** Directories included in the backup (relative to workDir). */
const BACKUP_DIRS = ["agents", "governance", "config"];
/** Files from workDir root included in the backup. */
const BACKUP_ROOT_FILES = ["sidjua.db"];


/**
 * Build an ISO-8601-safe timestamp string for filenames (no colons).
 * Example: 2026-03-26T07-22-11Z
 */
function isoFilenamestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}


/**
 * Add a directory to an archiver instance, recursively skipping master.key.
 * No-ops when the directory does not exist.
 */
function addDirToArchive(arc: archiver.Archiver, dirPath: string, archiveName: string): void {
  if (!existsSync(dirPath)) return;
  arc.glob("**/*", {
    cwd:    dirPath,
    ignore: [
      // Never include master.key from any location within the archived tree
      `**/${MASTER_KEY_FILENAME}`,
      MASTER_KEY_FILENAME,
    ],
    dot: true,
  }, { prefix: archiveName });
}


/**
 * List existing backup archives sorted by mtime descending (newest first).
 */
async function listBackups(backupDir: string): Promise<Array<{ filename: string; path: string; size: number; mtime: string }>> {
  if (!existsSync(backupDir)) return [];
  const entries = await readdir(backupDir);
  const zips    = entries.filter((f) => f.endsWith(".zip") && f.startsWith("sidjua-backup-"));
  const items   = zips.map((f) => {
    const full = join(backupDir, f);
    try {
      const st = statSync(full);
      return { filename: f, path: full, size: st.size, mtime: st.mtime.toISOString() };
    } catch (_err) {
      return null;
    }
  }).filter((x): x is { filename: string; path: string; size: number; mtime: string } => x !== null);
  items.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return items;
}


/**
 * Prune oldest archives so at most MAX_BACKUPS files remain.
 */
async function pruneOldBackups(backupDir: string): Promise<void> {
  const items = await listBackups(backupDir);
  const toDelete = items.slice(MAX_BACKUPS); // oldest are at the tail after desc sort
  for (const item of toDelete) {
    try {
      await unlink(item.path);
      logger.info("backup_pruned", `Deleted old backup: ${item.filename}`, {});
    } catch (err: unknown) {
      logger.warn("backup_prune_failed", `Could not delete old backup ${item.filename}`, {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}


/**
 * Register backup routes on the given Hono app.
 *
 * @param app     Hono application
 * @param workDir Workspace root (absolute path)
 */
export function registerBackupRoutes(app: Hono, workDir: string): void {
  const backupDir = join(workDir, "backups");

  // POST /api/v1/backup — create a new backup archive
  app.post("/api/v1/backup", requireScope("operator"), async (c) => {
    // Rate limiting: max 1 backup per minute
    const now = Date.now();
    if (now - _lastBackupAt < RATE_LIMIT_MS) {
      const retryAfterSec = Math.ceil((RATE_LIMIT_MS - (now - _lastBackupAt)) / 1000);
      return c.json({
        success: false,
        error:   `Backup rate limit exceeded — wait ${retryAfterSec}s before retrying`,
      }, 429);
    }

    // Ensure backup directory exists
    try {
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
    } catch (err: unknown) {
      logger.error("backup_dir_failed", "Could not create backup directory", {
        metadata: { path: backupDir, error: err instanceof Error ? err.message : String(err) },
      });
      return c.json({ success: false, error: "Could not create backup directory" }, 500);
    }

    const filename   = `sidjua-backup-${isoFilenamestamp()}.zip`;
    const outputPath = join(backupDir, filename);

    try {
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(outputPath, { mode: 0o600 });
        const arc    = archiver("zip", { zlib: { level: 6 } });

        output.on("close", resolve);
        arc.on("error", reject);
        arc.pipe(output);

        // Add configured workspace directories
        for (const dir of BACKUP_DIRS) {
          addDirToArchive(arc, join(workDir, dir), dir);
        }

        // Add .system/ directory — EXCLUDING master.key
        const systemDir = join(workDir, ".system");
        if (existsSync(systemDir)) {
          arc.glob("**/*", {
            cwd:    systemDir,
            ignore: [
              // master.key must NEVER be included in any backup archive
              MASTER_KEY_FILENAME,
              `**/${MASTER_KEY_FILENAME}`,
            ],
            dot: true,
          }, { prefix: ".system" });
        }

        // Add root-level DB file if present
        for (const file of BACKUP_ROOT_FILES) {
          const filePath = join(workDir, file);
          if (existsSync(filePath)) {
            arc.file(filePath, { name: file });
          }
        }

        arc.finalize();
      });
    } catch (err: unknown) {
      logger.error("backup_failed", "Backup archive creation failed", {
        metadata: { path: outputPath, error: err instanceof Error ? err.message : String(err) },
      });
      return c.json({ success: false, error: "Backup creation failed" }, 500);
    }

    _lastBackupAt = Date.now();

    // Prune old backups after successful creation
    await pruneOldBackups(backupDir);

    let sizeBytes = 0;
    try {
      sizeBytes = statSync(outputPath).size;
    } catch (_err) { /* non-fatal */ }

    const relativePath = `backups/${filename}`;
    logger.info("backup_created", `Backup created: ${filename}`, {
      metadata: { path: relativePath, sizeBytes },
    });

    return c.json({ success: true, path: relativePath, size_bytes: sizeBytes });
  });

  // GET /api/v1/backup/list — list existing backup archives
  app.get("/api/v1/backup/list", requireScope("readonly"), async (c) => {
    try {
      const items = await listBackups(backupDir);
      return c.json({
        backups: items.map(({ filename, size, mtime }) => ({
          filename,
          path:       `backups/${filename}`,
          size_bytes: size,
          created_at: mtime,
        })),
      });
    } catch (err: unknown) {
      logger.warn("backup_list_failed", "Could not list backup archives", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return c.json({ backups: [] });
    }
  });
}
