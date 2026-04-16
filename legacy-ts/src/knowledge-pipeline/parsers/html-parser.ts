// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: HTML Parser
 * Strips tags with cheerio, preserves heading structure.
 */

import type { Element } from "domhandler";
import type { Parser, ParsedDocument, ParsedSection } from "../types.js";
import { countTokens } from "../types.js";

const BLOCK_TAGS = new Set(["p", "li", "td", "th", "div", "article", "section"]);

export class HtmlParser implements Parser {
  async parse(content: Buffer | string, filename: string): Promise<ParsedDocument> {
    const text = Buffer.isBuffer(content) ? content.toString("utf-8") : content;
    const cheerio = await import("cheerio");
    const $ = cheerio.load(text);

    // Remove script/style
    $("script, style, noscript").remove();

    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;

    // Use for-of to get sequential CFA (avoids TS 5.x closure narrowing issues)
    for (const el of $("body *").toArray() as Element[]) {
      const elem = $(el);
      const tag = el.tagName?.toLowerCase() ?? "";

      if (/^h[1-6]$/.test(tag)) {
        if (currentSection !== null && currentSection.content.trim().length > 0) {
          sections.push(currentSection);
        }
        const level = parseInt(tag[1]!, 10);
        const heading = elem.text().trim();
        currentSection = { content: "", heading, level };
      } else if (BLOCK_TAGS.has(tag)) {
        const txt = elem.text().trim();
        if (txt.length === 0) continue;
        if (currentSection === null) {
          currentSection = { content: txt + "\n" };
        } else {
          currentSection.content += txt + "\n";
        }
      }
    }

    if (currentSection !== null && currentSection.content.trim().length > 0) {
      sections.push(currentSection);
    }

    if (sections.length === 0) {
      const plainText = $("body").text().trim();
      if (plainText.length > 0) {
        sections.push({ content: plainText });
      }
    }

    const totalTokens = sections.reduce((sum, s) => sum + countTokens(s.content), 0);
    return { sections, source_file: filename, total_tokens: totalTokens };
  }
}
