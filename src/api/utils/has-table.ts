// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Schema existence guard for API routes.
 *
 * Use this to guard queries that rely on tables created by `sidjua apply`
 * rather than catching SQLite error messages (fragile string matching).
 */

import type Database from "better-sqlite3";

/**
 * Check whether a table exists in the database.
 *
 * @param db        - Open SQLite database instance.
 * @param tableName - Table name to check.
 * @returns `true` if the table exists, `false` otherwise.
 *
 * @example
 * if (!hasTable(db, 'divisions')) return c.json({ divisions: [] });
 */
export function hasTable(db: InstanceType<typeof Database>, tableName: string): boolean {
  const row = db
    .prepare<[string], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .get(tableName);
  return row !== undefined;
}
