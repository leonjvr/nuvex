// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — TaskStore Column Migrations
 *
 * Adds columns that were introduced after initial schema creation.
 * Safe to call on every startup — each column is added only when absent.
 * Uses PRAGMA table_info to guard ALTER TABLE, which avoids "duplicate column"
 * errors on databases that already have the column from either a prior migration
 * run or a fresh CREATE TABLE with the column in its definition.
 */

import type { Database } from "../utils/db.js";


function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[];
  return cols.some((c) => c.name === column);
}


/**
 * Apply pending TaskStore schema additions to an existing database.
 *
 * V1.1 columns (recurring scheduling — added in Phase 9.5):
 *   recurring_schedule_id TEXT
 *   is_recurring INTEGER NOT NULL DEFAULT 0
 *
 * V1.2 columns (governance pipeline — added in Phase 10.7):
 *   source_metadata TEXT
 *   governance_override TEXT
 *
 * All ALTER TABLE statements are guarded with hasColumn() so this function
 * is safe to call on fresh databases (where CREATE TABLE already includes
 * the columns) and on legacy databases (where the columns are absent).
 */
export function runTaskMigrations(db: Database): void {
  const additions: Array<[string, string]> = [
    // V1.1 — recurring scheduling
    ["recurring_schedule_id", "TEXT"],
    ["is_recurring",          "INTEGER NOT NULL DEFAULT 0"],
    // V1.2 — governance pipeline
    ["source_metadata",       "TEXT"],
    ["governance_override",   "TEXT"],
  ];

  for (const [col, def] of additions) {
    if (!hasColumn(db, "tasks", col)) {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${col} ${def}`);
    }
  }
}
