// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — SQLite helpers (better-sqlite3)
 *
 * Provides:
 *   openDatabase(path)       — open/create a SQLite file, ensuring parent dirs exist
 *   runMigrations(db, list)  — apply pending version-ordered migrations
 *   tableExists(db, name)    — fast existence check for a table
 */

import BetterSQLite3, { type Database } from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Re-export the Database type so callers only need one import
export type { Database } from "better-sqlite3";


export interface DbMigration {
  version: string;
  description: string;
  up: string;
  down: string;
}


/**
 * Open (or create) a SQLite file at `dbPath`.
 * Automatically creates any missing parent directories.
 *
 * @throws if the database cannot be opened
 */
export function openDatabase(dbPath: string): Database {
  const parent = dirname(dbPath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  const db = new BetterSQLite3(dbPath);
  // WAL mode allows concurrent readers while a writer is active.
  // NORMAL synchronous is safe with WAL and avoids fsync on every commit.
  // busy_timeout prevents "database locked" errors under CLI/orchestrator concurrency.
  // Security: foreign_keys enforces referential integrity across all tables.
  db.pragma("journal_mode=WAL");
  db.pragma("synchronous=NORMAL");
  db.pragma("busy_timeout=5000");
  db.pragma("foreign_keys=ON");
  return db;
}


/**
 * Apply all pending migrations in version-sorted order.
 * Creates the `_migrations` tracking table if it does not exist.
 *
 * @returns Number of migrations applied (0 if all already applied)
 */
export function runMigrations(db: Database, migrations: DbMigration[]): number {
  // Ensure the migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const checkApplied = db.prepare<[string], { version: string }>(
    "SELECT version FROM _migrations WHERE version = ?",
  );
  const insertApplied = db.prepare<[string], void>(
    "INSERT INTO _migrations (version) VALUES (?)",
  );

  let count = 0;
  const sorted = [...migrations].sort((a, b) => a.version.localeCompare(b.version));

  for (const migration of sorted) {
    const existing = checkApplied.get(migration.version);
    if (existing !== undefined) continue;

    // Run the migration in a transaction for atomicity
    db.transaction(() => {
      db.exec(migration.up);
      insertApplied.run(migration.version);
    })();
    count++;
  }

  return count;
}


/**
 * Return true if a table with the given name exists in the database.
 */
export function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(tableName);
  return row !== undefined;
}


/**
 * Return true if a view with the given name exists in the database.
 */
export function viewExists(db: Database, viewName: string): boolean {
  const row = db
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='view' AND name=?",
    )
    .get(viewName);
  return row !== undefined;
}
