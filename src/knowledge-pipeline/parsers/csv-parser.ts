// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: CSV Parser
 * Row-based chunks with header context using papaparse.
 */

import type { Parser, ParsedDocument, ParsedSection } from "../types.js";
import { countTokens } from "../types.js";
import Papa from "papaparse";

const ROWS_PER_CHUNK = 20;

export class CsvParser implements Parser {
  async parse(content: Buffer | string, filename: string): Promise<ParsedDocument> {
    const text = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
    const result = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: true,
    });

    const rows = result.data;
    if (rows.length === 0) {
      return { sections: [], source_file: filename, total_tokens: 0 };
    }

    const headers = rows[0] ?? [];
    const dataRows = rows.slice(1);
    const sections: ParsedSection[] = [];

    // Create chunks of ROWS_PER_CHUNK rows each
    for (let i = 0; i < dataRows.length; i += ROWS_PER_CHUNK) {
      const chunkRows = dataRows.slice(i, i + ROWS_PER_CHUNK);
      const lines = chunkRows.map((row) =>
        headers.map((h, j) => `${h}: ${row[j] ?? ""}`).join(" | "),
      );
      const content = `Headers: ${headers.join(", ")}\n${lines.join("\n")}`;
      sections.push({
        content,
        heading: `Rows ${i + 1}–${Math.min(i + ROWS_PER_CHUNK, dataRows.length)}`,
        metadata: { row_start: i + 1, row_end: Math.min(i + ROWS_PER_CHUNK, dataRows.length) },
      });
    }

    const totalTokens = sections.reduce((sum, s) => sum + countTokens(s.content), 0);
    return { sections, source_file: filename, total_tokens: totalTokens };
  }
}
