// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10: Table formatter
 *
 * Column-aligned text table output with automatic width calculation.
 * Supports fixed/auto column widths, left/right alignment, and custom formatters.
 */


export interface TableColumn {
  header:  string;
  key:     string;
  width?:  number;         // fixed width; auto-calculated if omitted
  align?:  "left" | "right";
  format?: (value: unknown) => string;
}

export interface TableConfig {
  columns:   TableColumn[];
  maxWidth?: number;       // terminal width limit (default: process.stdout.columns or 120)
}


/**
 * Format an array of row objects into a column-aligned text table.
 *
 * Returns a string with header row, separator line, and one data row per entry.
 * Returns an empty string when rows is empty.
 */
export function formatTable(
  rows:   Record<string, unknown>[],
  config: TableConfig,
): string {
  const { columns } = config;
  if (rows.length === 0) return "";

  const maxWidth = config.maxWidth
    ?? (typeof process !== "undefined" && process.stdout.columns > 0
      ? process.stdout.columns
      : 120);

  // Serialize every cell value to a string using the optional formatter.
  function cell(row: Record<string, unknown>, col: TableColumn): string {
    const raw = row[col.key];
    if (col.format !== undefined) return col.format(raw);
    if (raw === null || raw === undefined) return "";
    return String(raw);
  }

  // Compute effective column widths.
  const widths: number[] = columns.map((col, i) => {
    if (col.width !== undefined) return col.width;
    // Auto: max of header length and longest cell value.
    const headerLen = col.header.length;
    const maxCell   = rows.reduce<number>((m, row) => {
      return Math.max(m, cell(row, col).length);
    }, 0);
    return Math.max(headerLen, maxCell);
  });

  // Pad / truncate a string to the target width.
  function pad(s: string, width: number, align: "left" | "right" = "left"): string {
    if (s.length > width) return s.slice(0, width - 1) + "…";
    if (align === "right") return s.padStart(width);
    return s.padEnd(width);
  }

  const lines: string[] = [];

  // Header row.
  const headerParts = columns.map((col, i) =>
    pad(col.header, widths[i]!, col.align ?? "left"),
  );
  lines.push(headerParts.join("  "));

  // Separator line.
  const sepParts = widths.map((w) => "─".repeat(w));
  lines.push(sepParts.join("  "));

  // Data rows.
  for (const row of rows) {
    const rowParts = columns.map((col, i) =>
      pad(cell(row, col), widths[i]!, col.align ?? "left"),
    );
    lines.push(rowParts.join("  "));
  }

  // Trim each line to maxWidth.
  return lines.map((l) => l.slice(0, maxWidth)).join("\n");
}
