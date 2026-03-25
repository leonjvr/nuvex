// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — File download utilities
 *
 * Uses the browser Blob + anchor approach which works in both
 * Tauri WebView and standard browsers. A Tauri FS/dialog upgrade
 * can be layered on top in a future prompt without API changes.
 */

/** Trigger a file download with the given content and filename. */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick to ensure the download has started
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Download data as a JSON file. */
export function downloadJson(data: unknown, filename: string): void {
  triggerDownload(JSON.stringify(data, null, 2), filename, 'application/json');
}

/** Convert an array of objects to CSV and download. */
export function downloadCsv(rows: Record<string, unknown>[], filename: string): void {
  if (rows.length === 0) {
    triggerDownload('', filename, 'text/csv');
    return;
  }

  const keys   = Object.keys(rows[0]!);
  const header = keys.join(',');
  const body   = rows.map((row) =>
    keys.map((k) => {
      const val = row[k];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Quote fields containing commas, quotes, or newlines
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(','),
  );

  triggerDownload([header, ...body].join('\n'), filename, 'text/csv');
}
