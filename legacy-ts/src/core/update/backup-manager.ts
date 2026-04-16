// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Update Backup Manager
 *
 * Creates and manages pre-update snapshots of system/ and migration state.
 * Backs up SIDJUA-owned files only (system/ dir + .migration-state.json).
 * User-owned data (data/divisions/, data/governance/) is never touched.
 *
 * Backup location: <dataDir>/backups/<backup-id>/
 * Retention policy: <dataDir>/backups/retention.json
 *
 * Archives use streaming tar.gz via the system `tar` binary to avoid
 * loading entire directories into memory.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join }          from "node:path";
import { execFile }      from "node:child_process";
import { promisify }     from "node:util";
import { createLogger }  from "../logger.js";
import { loadMigrationState } from "./migration-framework.js";
import { loadVersionInfo }    from "../governance/rule-loader.js";

const execFileAsync = promisify(execFile);
const logger        = createLogger("backup-manager");


export interface BackupContents {
  systemSnapshot:  boolean;
  schemaState:     boolean;
}

export interface BackupInfo {
  id:                       string;
  type:                     "pre-update" | "manual";
  label?:                   string;
  createdAt:                string;
  sidjuaVersion:            string;
  governanceRulesetVersion: string;
  schemaVersion:            number;
  sizeBytes:                number;
  contents:                 BackupContents;
}

interface RetentionPolicy {
  max_backups:  number;
  max_age_days: number;
  min_keep:     number;
  auto_cleanup: boolean;
}

const DEFAULT_RETENTION: RetentionPolicy = {
  max_backups:  5,
  max_age_days: 90,
  min_keep:     2,
  auto_cleanup: true,
};


export class UpdateBackupManager {
  private readonly dataDir:   string;
  private readonly systemDir: string;
  private readonly backupsDir: string;

  constructor(dataDir: string, systemDir: string) {
    this.dataDir    = dataDir;
    this.systemDir  = systemDir;
    this.backupsDir = join(dataDir, "backups");
  }

  // --------------------------------------------------------------------------
  // createPreUpdateBackup
  // --------------------------------------------------------------------------

  async createPreUpdateBackup(targetVersion: string): Promise<BackupInfo> {
    const id = `pre-${targetVersion}_${isoCompact()}`;
    return this._createBackup(id, "pre-update", undefined);
  }

  // --------------------------------------------------------------------------
  // createManualBackup
  // --------------------------------------------------------------------------

  async createManualBackup(label?: string): Promise<BackupInfo> {
    const safeSuffix = label ? `_${label.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40)}` : "";
    const id = `manual${safeSuffix}_${isoCompact()}`;
    return this._createBackup(id, "manual", label);
  }

  // --------------------------------------------------------------------------
  // listBackups
  // --------------------------------------------------------------------------

  async listBackups(): Promise<BackupInfo[]> {
    if (!existsSync(this.backupsDir)) return [];

    const results: BackupInfo[] = [];
    for (const entry of readdirSync(this.backupsDir)) {
      if (entry.startsWith(".")) continue;
      const manifestPath = join(this.backupsDir, entry, "manifest.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const raw  = readFileSync(manifestPath, "utf-8");
        const info = JSON.parse(raw) as BackupInfo;
        results.push(info);
      } catch (e: unknown) {
        logger.warn("backup-manager", `Failed to read backup manifest for ${entry}`, {
          error: { code: "PARSE_ERROR", message: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // --------------------------------------------------------------------------
  // restoreBackup
  // --------------------------------------------------------------------------

  async restoreBackup(backupId: string): Promise<void> {
    const backupDir = join(this.backupsDir, backupId);
    if (!existsSync(backupDir)) {
      throw new Error(`Backup '${backupId}' not found`);
    }

    const archive = join(backupDir, "system.tar.gz");
    if (existsSync(archive)) {
      logger.info("backup-manager", `Restoring system/ from backup ${backupId}`);
      // Remove current system dir content then extract
      if (existsSync(this.systemDir)) {
        rmSync(this.systemDir, { recursive: true, force: true });
      }
      mkdirSync(this.systemDir, { recursive: true });
      await execFileAsync("tar", ["-xzf", archive, "-C", this.systemDir, "--strip-components=1"]);
    }

    const stateSrc = join(backupDir, ".migration-state.json");
    const stateDst = join(this.dataDir, ".migration-state.json");
    if (existsSync(stateSrc)) {
      copyFileSync(stateSrc, stateDst);
    }

    logger.info("backup-manager", `Backup ${backupId} restored successfully`);
  }

  // --------------------------------------------------------------------------
  // cleanupOldBackups
  // --------------------------------------------------------------------------

  async cleanupOldBackups(): Promise<number> {
    const policy    = this._loadRetention();
    const backups   = await this.listBackups();
    let   deleted   = 0;

    if (backups.length <= policy.min_keep) return 0;

    const now      = Date.now();
    const maxAgeMs = policy.max_age_days * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];

    // Age-based eviction (always keep min_keep newest)
    for (let i = policy.min_keep; i < backups.length; i++) {
      const backup = backups[i]!;
      const age    = now - new Date(backup.createdAt).getTime();
      if (age > maxAgeMs) {
        toDelete.push(backup.id);
      }
    }

    // Count-based eviction
    const excess = backups.length - policy.max_backups;
    for (let i = policy.min_keep; i < backups.length && toDelete.length < excess; i++) {
      const id = backups[i]!.id;
      if (!toDelete.includes(id)) toDelete.push(id);
    }

    for (const id of toDelete) {
      const backupDir = join(this.backupsDir, id);
      try {
        rmSync(backupDir, { recursive: true, force: true });
        deleted++;
        logger.info("backup-manager", `Deleted old backup: ${id}`);
      } catch (e: unknown) {
        logger.warn("backup-manager", `Failed to delete backup ${id}`, {
          error: { code: "DELETE_ERROR", message: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    return deleted;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private async _createBackup(
    id:    string,
    type:  "pre-update" | "manual",
    label: string | undefined,
  ): Promise<BackupInfo> {
    const backupDir = join(this.backupsDir, id);
    mkdirSync(backupDir, { recursive: true });

    const createdAt = new Date().toISOString();
    const contents: BackupContents = { systemSnapshot: false, schemaState: false };

    // Archive system/ via streaming tar
    if (existsSync(this.systemDir)) {
      const archivePath = join(backupDir, "system.tar.gz");
      await execFileAsync("tar", ["-czf", archivePath, "-C", this.systemDir, "."]);
      contents.systemSnapshot = true;
    }

    // Copy migration state
    const stateSrc = join(this.dataDir, ".migration-state.json");
    if (existsSync(stateSrc)) {
      copyFileSync(stateSrc, join(backupDir, ".migration-state.json"));
      contents.schemaState = true;
    }

    // Compute backup size
    const sizeBytes = dirSizeBytes(backupDir);

    // Read metadata
    const migState      = loadMigrationState(this.dataDir);
    const govInfo       = loadVersionInfo(join(this.systemDir, "governance"));
    const govVer        = govInfo?.ruleset_version ?? "unknown";
    const sidjuaVerFile = join(this.systemDir, "VERSION");
    const sidjuaVersion = existsSync(sidjuaVerFile)
      ? readFileSync(sidjuaVerFile, "utf-8").trim()
      : "unknown";

    const info: BackupInfo = {
      id,
      type,
      ...(label !== undefined ? { label } : {}),
      createdAt,
      sidjuaVersion,
      governanceRulesetVersion: govVer,
      schemaVersion: migState.schemaVersion,
      sizeBytes,
      contents,
    };

    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(info, null, 2), "utf-8");
    logger.info("backup-manager", `Backup created: ${id}`, {
      metadata: { type, size_bytes: sizeBytes },
    });

    return info;
  }

  private _loadRetention(): RetentionPolicy {
    const retentionPath = join(this.backupsDir, "retention.json");
    if (!existsSync(retentionPath)) return { ...DEFAULT_RETENTION };

    try {
      const raw = readFileSync(retentionPath, "utf-8");
      const cfg = JSON.parse(raw) as Partial<RetentionPolicy>;
      return { ...DEFAULT_RETENTION, ...cfg };
    } catch (e: unknown) {
      logger.warn("backup-manager", "Retention policy parse failed — using defaults", { metadata: { error: e instanceof Error ? e.message : String(e), retentionPath } });
      return { ...DEFAULT_RETENTION };
    }
  }
}


function isoCompact(): string {
  return new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
}

function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isFile()) {
          total += st.size;
        } else if (st.isDirectory()) {
          total += dirSizeBytes(full);
        }
      } catch (e: unknown) {
        void e; /* cleanup-ignore: statSync failure on directory entry during size calculation — skip entry */
      }
    }
  } catch (e: unknown) {
    void e; /* cleanup-ignore: readdirSync failure during size calculation — return partial total */
  }
  return total;
}
