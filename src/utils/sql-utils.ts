// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — SQL utility helpers
 *
 * Shared utilities for safe SQL construction. All SQL values MUST use
 * parameterized queries (`?` placeholders). This module provides helpers
 * for the rare cases where some SQL structure (LIKE patterns, column
 * whitelisting) requires additional sanitization beyond parameterization.
 */


/**
 * Escape special LIKE metacharacters in user-supplied input so the string
 * is treated as a literal substring match when used with `LIKE ? ESCAPE '\\'`.
 *
 * Escapes: `\` → `\\`, `%` → `\%`, `_` → `\_`
 *
 * Usage:
 *   ```sql
 *   WHERE column LIKE ? ESCAPE '\\'
 *   ```
 *   with param: `%${sanitizeLikePattern(userInput)}%`
 *
 * Idempotent: sanitizeLikePattern(sanitizeLikePattern(x)) === sanitizeLikePattern(x)
 * is NOT guaranteed — always sanitize raw user input exactly once.
 */
export function sanitizeLikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}


/**
 * Assert that a column name is in the provided whitelist.
 * Throws a TypeError with a clear message if not found.
 *
 * Used to prevent ORDER BY and dynamic column injection when column names
 * must be interpolated into SQL (parameterization cannot be used for
 * identifiers).
 */
export function assertSafeColumn(column: string, whitelist: ReadonlySet<string>): void {
  if (!whitelist.has(column)) {
    throw new TypeError(`Invalid SQL column name: "${column}"`);
  }
}
