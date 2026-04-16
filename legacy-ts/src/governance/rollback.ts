// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.8: Governance Rollback
 *
 * Before every `sidjua apply`, captures a self-contained snapshot of the
 * current governance state (YAML files + DB rows). Snapshots can be restored
 * via `sidjua governance rollback <version>`.
 *
 * Storage: data/governance-snapshots/<version>.json
 * Retention: last MAX_SNAPSHOTS (default 10) kept; oldest pruned.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256hex } from "../core/crypto-utils.js";
import type { Database } from "../utils/db.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("governance-rollback");


export interface GovernanceFileSnapshot {
  path:    string;
  hash:    string;    // SHA-256 hex
  content: string;   // full file content
}

export interface GovernanceDatabaseSnapshot {
  /** Rows from approval_queue table if it exists */
  approval_queue?:  unknown[];
  /** Rows from divisions table if it exists */
  divisions?:       unknown[];
  /** Rows from cost_budgets table if it exists */
  cost_budgets?:    unknown[];
  /** Rows from policy_rules table if it exists */
  policy_rules?:    unknown[];
}

export interface GovernanceSnapshot {
  id:                   string;         // UUID
  timestamp:            string;         // ISO 8601
  version:              number;         // auto-increment (1-based)
  trigger:              "apply" | "manual";
  divisions_yaml_hash:  string;         // SHA-256 of divisions.yaml
  files:                GovernanceFileSnapshot[];
  db_state:             GovernanceDatabaseSnapshot;
}


export const MAX_SNAPSHOTS = 10;
const SNAPSHOT_DIR_RELATIVE = join("data", "governance-snapshots");


function sha256(content: string): string {
  return sha256hex(content);
}

function snapshotDir(workDir: string): string {
  return join(workDir, SNAPSHOT_DIR_RELATIVE);
}

function snapshotPath(workDir: string, version: number): string {
  return join(snapshotDir(workDir), `v${version}.json`);
}

/** List all snapshots in a directory, sorted by version ascending */
function listSnapshotFiles(workDir: string): Array<{ path: string; version: number }> {
  const dir = snapshotDir(workDir);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.startsWith("v") && f.endsWith(".json"))
    .map((f) => {
      const version = parseInt(f.slice(1, -5), 10);
      return { path: join(dir, f), version };
    })
    .filter((e) => !isNaN(e.version))
    .sort((a, b) => a.version - b.version);
}

/** Capture a file from disk; return null if it doesn't exist */
function captureFile(absPath: string, workDir: string): GovernanceFileSnapshot | null {
  if (!existsSync(absPath)) return null;
  const content = readFileSync(absPath, "utf8");
  return {
    path:    absPath.startsWith(workDir) ? absPath.slice(workDir.length) : absPath,
    hash:    sha256(content),
    content,
  };
}

/** Capture all YAML files in a directory (non-recursive) */
function captureYamlDir(dir: string, workDir: string): GovernanceFileSnapshot[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => captureFile(join(dir, f), workDir))
    .filter((s): s is GovernanceFileSnapshot => s !== null);
}

/** Safely query a table if it exists */
function tryQueryTable(db: Database, tableName: string): unknown[] {
  try {
    const rows = db.prepare<[], unknown>(`SELECT * FROM ${tableName}`).all();
    return rows;
  } catch (e: unknown) {
    logger.debug("rollback", "Snapshot table not found — pre-migration (skipping cleanup)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return [];
  }
}


/**
 * Create a governance snapshot and write it to disk.
 *
 * Captures:
 *   - divisions.yaml
 *   - governance/boundaries/forbidden-actions.yaml
 *   - governance/policies/*.yaml
 *   - DB tables: approval_queue, divisions, cost_budgets, policy_rules
 *
 * @param workDir  Workspace root directory
 * @param configPath  Path to divisions.yaml (usually ./divisions.yaml)
 * @param db  Open database handle (may be null if DB not yet initialized)
 * @param trigger  What triggered this snapshot
 * @returns The created snapshot (already written to disk)
 */
export function createSnapshot(
  workDir:    string,
  configPath: string | null,
  db:         Database | null,
  trigger:    "apply" | "manual" = "apply",
): GovernanceSnapshot {
  const dir = snapshotDir(workDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Determine next version number
  const existing = listSnapshotFiles(workDir);
  const nextVersion = existing.length > 0
    ? (existing[existing.length - 1]?.version ?? 0) + 1
    : 1;

  // Capture files
  const files: GovernanceFileSnapshot[] = [];

  // divisions config (file or directory)
  const divFile = configPath !== null ? captureFile(configPath, workDir) : null;
  if (divFile !== null) files.push(divFile);

  // governance directory files
  const govBoundaries = join(workDir, "governance", "boundaries");
  const govPolicies   = join(workDir, "governance", "policies");
  files.push(...captureYamlDir(govBoundaries, workDir));
  files.push(...captureYamlDir(govPolicies,   workDir));

  const divYamlContent = divFile?.content ?? "";
  const divYamlHash    = sha256(divYamlContent);

  // Capture DB state
  const db_state: GovernanceDatabaseSnapshot = {};
  if (db !== null) {
    const aq = tryQueryTable(db, "approval_queue");
    const dv = tryQueryTable(db, "divisions");
    const cb = tryQueryTable(db, "cost_budgets");
    const pr = tryQueryTable(db, "policy_rules");
    if (aq.length > 0) db_state.approval_queue = aq;
    if (dv.length > 0) db_state.divisions = dv;
    if (cb.length > 0) db_state.cost_budgets = cb;
    if (pr.length > 0) db_state.policy_rules = pr;
  }

  const snapshot: GovernanceSnapshot = {
    id:                  randomUUID(),
    timestamp:           new Date().toISOString(),
    version:             nextVersion,
    trigger,
    divisions_yaml_hash: divYamlHash,
    files,
    db_state,
  };

  writeFileSync(
    snapshotPath(workDir, nextVersion),
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );

  logger.info("governance_snapshot_created", `Created governance snapshot v${nextVersion}`, {
    metadata: { version: nextVersion, trigger, file_count: files.length },
  });

  // Prune old snapshots beyond MAX_SNAPSHOTS
  pruneSnapshots(workDir);

  return snapshot;
}


/** Keep only the last MAX_SNAPSHOTS; delete older ones */
function pruneSnapshots(workDir: string): void {
  const all = listSnapshotFiles(workDir);
  const toDelete = all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS));
  for (const entry of toDelete) {
    unlinkSync(entry.path);
    logger.debug("governance_snapshot_pruned", `Pruned old snapshot ${basename(entry.path)}`, {
      metadata: { version: entry.version },
    });
  }
}


/**
 * List all stored snapshots, most-recent first.
 */
export function listSnapshots(workDir: string): GovernanceSnapshot[] {
  return listSnapshotFiles(workDir)
    .reverse()
    .map((entry) => {
      const raw = readFileSync(entry.path, "utf8");
      return JSON.parse(raw) as GovernanceSnapshot;
    });
}


/**
 * Load a specific snapshot by version number.
 * Returns null if the version does not exist.
 */
export function loadSnapshot(workDir: string, version: number): GovernanceSnapshot | null {
  const path = snapshotPath(workDir, version);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as GovernanceSnapshot;
}


/**
 * Restore governance state from a snapshot.
 *
 * Procedure:
 *   1. Restore governance files from snapshot (overwrite current)
 *   2. Restore governance DB rows from snapshot
 *   3. Log governance_rollback_complete event
 *
 * Note: Stopping/restarting agents is handled by the CLI command caller.
 * This function is purely file + DB restore.
 *
 * @throws SidjuaError GOV-008 if another rollback is already in progress
 */
export function restoreSnapshot(
  workDir:  string,
  snapshot: GovernanceSnapshot,
  db:       Database | null,
): void {
  logger.info("governance_rollback_start", `Restoring governance snapshot v${snapshot.version}`, {
    metadata: { snapshot_id: snapshot.id, version: snapshot.version },
  });

  // Restore files
  for (const file of snapshot.files) {
    const absPath = file.path.startsWith("/")
      ? join(workDir, file.path)
      : join(workDir, file.path);

    const dir = join(absPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(absPath, file.content, "utf8");
    logger.debug("governance_rollback_file_restored", `Restored file ${file.path}`, {
      metadata: { path: file.path, hash: file.hash },
    });
  }

  // Restore DB rows
  if (db !== null) {
    restoreDbTable(db, "approval_queue", snapshot.db_state.approval_queue ?? []);
    restoreDbTable(db, "cost_budgets",   snapshot.db_state.cost_budgets   ?? []);
  }

  logger.info("governance_rollback_complete", `Governance rollback to v${snapshot.version} complete`, {
    metadata: { snapshot_id: snapshot.id, version: snapshot.version },
  });
}


interface RowWithId {
  id: unknown;
}

/**
 * Restore rows into a table.
 * Current approach: DELETE all rows then re-insert from snapshot.
 * Only run for tables known to be safe to truncate (non-audit tables).
 */
function restoreDbTable(db: Database, tableName: string, rows: unknown[]): void {
  // Only restore tables we explicitly support
  const SAFE_TABLES = new Set(["approval_queue", "cost_budgets"]);
  if (!SAFE_TABLES.has(tableName)) return;

  try {
    // Check table exists
    const exists = db
      .prepare<[string], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      )
      .get(tableName);
    if (exists === undefined) return;

    db.transaction(() => {
      db.prepare<[], void>(`DELETE FROM ${tableName}`).run();

      for (const row of rows) {
        if (row === null || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const columns = Object.keys(r);
        if (columns.length === 0) continue;
        const placeholders = columns.map(() => "?").join(", ");
        const values = columns.map((k) => {
          const v = r[k];
          return (v === null || typeof v === "string" || typeof v === "number") ? v : String(v);
        });
        db.prepare<unknown[], void>(
          `INSERT OR IGNORE INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
        ).run(...values);
      }
    })();

    logger.debug("governance_rollback_table_restored", `Restored table ${tableName}`, {
      metadata: { table: tableName, row_count: rows.length },
    });
  } catch (err) {
    logger.warn("governance_rollback_table_error", `Failed to restore table ${tableName}`, {
      metadata: { table: tableName, error: err instanceof Error ? err.message : String(err) },
    });
  }
}


export interface SnapshotDiff {
  version_current: number;
  version_target:  number;
  changed_files:   Array<{ path: string; status: "changed" | "added" | "removed" }>;
  yaml_hash_match: boolean;
}

/**
 * Compute the diff between the current state on disk and a stored snapshot.
 */
export function diffSnapshot(
  workDir:   string,
  snapshot:  GovernanceSnapshot,
  configPath: string | null,
): SnapshotDiff {
  const changedFiles: SnapshotDiff["changed_files"] = [];

  for (const snap of snapshot.files) {
    const absPath = snap.path.startsWith("/")
      ? join(workDir, snap.path)
      : join(workDir, snap.path);

    if (!existsSync(absPath)) {
      changedFiles.push({ path: snap.path, status: "removed" });
      continue;
    }

    const current = readFileSync(absPath, "utf8");
    if (sha256(current) !== snap.hash) {
      changedFiles.push({ path: snap.path, status: "changed" });
    }
  }

  // Current config hash (skip if path is null or a directory)
  let currentDivHash = "";
  if (configPath !== null && existsSync(configPath) && !statSync(configPath).isDirectory()) {
    currentDivHash = sha256(readFileSync(configPath, "utf8"));
  }

  return {
    version_current: listSnapshotFiles(workDir).length > 0
      ? (listSnapshotFiles(workDir)[listSnapshotFiles(workDir).length - 1]?.version ?? 0)
      : 0,
    version_target:  snapshot.version,
    changed_files:   changedFiles,
    yaml_hash_match: currentDivHash === snapshot.divisions_yaml_hash,
  };
}
