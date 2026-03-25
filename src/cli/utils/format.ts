// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Shared CLI formatting utilities.
 *
 * Houses helpers that were previously duplicated across CLI command files.
 */


/**
 * Format the age of an ISO timestamp as a compact human-readable string.
 *
 * @param isoTs - ISO 8601 timestamp string.
 * @param now   - Reference time in ms (defaults to `Date.now()`).
 *
 * @example
 * formatAge("2026-03-10T00:00:00Z", Date.now())  // "5m", "2h", "3d"
 */
/**
 * Format a byte count as a compact human-readable string with up to GB tier.
 *
 * @example
 * formatBytes(512)            // "512 B"
 * formatBytes(2048)           // "2.0 KB"
 * formatBytes(1536000)        // "1.5 MB"
 * formatBytes(2147483648)     // "2.00 GB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------

export function formatAge(isoTs: string, now: number = Date.now()): string {
  const ms      = now - new Date(isoTs).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `${hours}h`;
  const days  = Math.floor(hours / 24);
  return `${days}d`;
}
