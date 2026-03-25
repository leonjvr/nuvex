// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: PDF Parser
 * Uses pdf-parse for text extraction.
 */

import { createRequire } from "node:module";
import type { Parser, ParsedDocument, ParsedSection } from "../types.js";
import { countTokens } from "../types.js";

const _require = createRequire(import.meta.url);

interface PdfParseResult {
  text: string;
  numpages: number;
  info: unknown;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = _require("pdf-parse") as (buf: Buffer) => Promise<PdfParseResult>;

export class PdfParser implements Parser {
  async parse(content: Buffer | string, filename: string): Promise<ParsedDocument> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content as string);

    const data = await pdfParse(buf);

    const sections = this._splitByPage(data.text, data.numpages);
    const totalTokens = sections.reduce((sum, s) => sum + countTokens(s.content), 0);
    return {
      sections,
      source_file: filename,
      total_tokens: totalTokens,
      metadata: { pages: data.numpages, info: data.info },
    };
  }

  private _splitByPage(text: string, numPages: number): ParsedSection[] {
    // pdf-parse uses \f (form feed) as page separator in some cases
    // Also try splitting by page markers
    const pageSeparator = /\f|\n{3,}/;
    const rawPages = text.split(pageSeparator);
    const sections: ParsedSection[] = [];

    for (let i = 0; i < rawPages.length; i++) {
      const content = rawPages[i]!.trim();
      if (content.length === 0) continue;
      sections.push({
        content,
        page_number: Math.min(i + 1, numPages),
      });
    }

    if (sections.length === 0 && text.trim().length > 0) {
      return [{ content: text.trim(), page_number: 1 }];
    }
    return sections;
  }
}
