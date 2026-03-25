// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Code Parser
 * Regex-based function/class boundary detection (no treesitter in V1).
 */

import type { Parser, ParsedDocument, ParsedSection } from "../types.js";
import { countTokens } from "../types.js";

// Patterns to detect top-level declarations
const BOUNDARY_PATTERNS = [
  /^(export\s+)?(async\s+)?function\s+\w+/m,
  /^(export\s+)?class\s+\w+/m,
  /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/m,
  /^(export\s+)?const\s+\w+\s*=\s*\{/m,
  /^\/\/ [-=]{3,}/m,   // comment dividers
  /^\/\*\*/m,           // JSDoc blocks
];

export class CodeParser implements Parser {
  async parse(content: Buffer | string, filename: string): Promise<ParsedDocument> {
    const text = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "txt";
    const sections = this._splitByDeclaration(text, ext);
    const totalTokens = sections.reduce((sum, s) => sum + countTokens(s.content), 0);
    return { sections, source_file: filename, total_tokens: totalTokens, metadata: { language: ext } };
  }

  private _splitByDeclaration(text: string, ext: string): ParsedSection[] {
    const lines = text.split("\n");
    const sections: ParsedSection[] = [];
    const boundaries: number[] = [0];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      for (const pattern of BOUNDARY_PATTERNS) {
        if (pattern.test(line)) {
          boundaries.push(i);
          break;
        }
      }
    }
    boundaries.push(lines.length);

    for (let b = 0; b < boundaries.length - 1; b++) {
      const start = boundaries[b]!;
      const end = boundaries[b + 1]!;
      const chunk = lines.slice(start, end).join("\n").trim();
      if (chunk.length === 0) continue;

      // Extract a heading from the first meaningful line
      const firstLine = lines[start]?.trim() ?? "";
      sections.push({
        content: chunk,
        heading: firstLine.substring(0, 80),
        metadata: { language: ext, line_start: start + 1, line_end: end },
      });
    }

    if (sections.length === 0 && text.trim().length > 0) {
      return [{ content: text.trim(), metadata: { language: ext } }];
    }
    return sections;
  }
}
