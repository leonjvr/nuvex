// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Markdown Parser
 * Structure-aware: headings define section boundaries.
 */

import type { Parser, ParsedDocument, ParsedSection } from "../types.js";
import { countTokens } from "../types.js";

export class MarkdownParser implements Parser {
  async parse(content: Buffer | string, filename: string): Promise<ParsedDocument> {
    const text = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
    const sections = this._parseSections(text);
    const totalTokens = sections.reduce((sum, s) => sum + countTokens(s.content), 0);
    return { sections, source_file: filename, total_tokens: totalTokens };
  }

  private _parseSections(text: string): ParsedSection[] {
    const lines = text.split("\n");
    const sections: ParsedSection[] = [];
    let currentHeading: string | undefined;
    let currentLevel: number | undefined;
    let currentLines: string[] = [];
    let currentPage = 1;

    const flush = () => {
      const content = currentLines.join("\n").trim();
      if (content.length > 0) {
        const s: ParsedSection = { content, page_number: currentPage };
        if (currentHeading !== undefined) s.heading = currentHeading;
        if (currentLevel !== undefined) s.level = currentLevel;
        sections.push(s);
      }
      currentLines = [];
    };

    for (const line of lines) {
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
      if (headingMatch) {
        flush();
        currentLevel = headingMatch[1]!.length;
        currentHeading = headingMatch[2]!.trim();
      } else {
        // Track page breaks (common convention in converted docs)
        if (line.includes("\f")) currentPage++;
        currentLines.push(line);
      }
    }
    flush();

    // If no headings found, return as single section
    if (sections.length === 0 && text.trim().length > 0) {
      return [{ content: text.trim(), page_number: 1 }];
    }
    return sections;
  }
}
