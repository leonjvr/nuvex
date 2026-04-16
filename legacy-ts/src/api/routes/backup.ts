// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Backup REST endpoint
 *
 * POST /api/v1/backup      — create a backup archive via core backup engine
 * GET  /api/v1/backup/list — list existing backup archives
 *
 * Security constraints delegated to core/backup.ts:
 *   - master.key is NEVER included in any backup archive
 *   - WAL checkpoint before copy (prevents dirty databases)
 *   - HMAC-signed manifest for tamper detection
 *   - Retention enforced via BackupConfig (default: 5 archives)
 */

import { Hono }             from "hono";
import { basename }         from "node:path";
import { createLogger }     from "../../core/logger.js";
import { requireScope }     from "../middleware/require-scope.js";
import {
  createBackup,
  listBackups,
  getBackupConfig,
} from "../../core/backup.js";

const logger = createLogger("backup");

/** Minimum time between successive backup requests (ms). */
const RATE_LIMIT_MS = 60_000;

/** Last backup timestamp for rate limiting (per-process). */
let _lastBackupAt = 0;


/**
 * Register backup routes on the given Hono app.
 *
 * @param app     Hono application
 * @param workDir Workspace root (absolute path)
 */
export function registerBackupRoutes(app: Hono, workDir: string): void {
  const cfg = getBackupConfig(workDir);

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

    try {
      const result = await createBackup({ workDir, configPath: "" }, cfg);

      _lastBackupAt = Date.now();

      const filename     = basename(result.archive_path);
      const relativePath = `${cfg.directory.replace(workDir + "/", "")}/${filename}`;

      logger.info("backup_created", `Backup created: ${filename}`, {
        metadata: { id: result.id, path: result.archive_path, sizeBytes: result.archive_size_bytes },
      });

      return c.json({
        success:    true,
        id:         result.id,
        path:       relativePath,
        size_bytes: result.archive_size_bytes,
        ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      });
    } catch (err: unknown) {
      logger.error("backup_failed", "Backup creation failed", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return c.json({ success: false, error: "Backup creation failed" }, 500);
    }
  });

  // GET /api/v1/backup/list — list existing backup archives
  app.get("/api/v1/backup/list", requireScope("readonly"), async (c) => {
    try {
      const items = await listBackups(cfg.directory);
      return c.json({
        backups: items.map((item) => ({
          id:         item.id,
          filename:   basename(item.archive_path),
          path:       `${cfg.directory.replace(workDir + "/", "")}/${basename(item.archive_path)}`,
          size_bytes: item.archive_size_bytes,
          created_at: item.created_at,
          ...(item.label !== undefined ? { label: item.label } : {}),
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
