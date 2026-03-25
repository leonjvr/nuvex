// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: DOCX Parser
 * Converts DOCX to Markdown via mammoth, then parses with MarkdownParser.
 */

import type { Parser, ParsedDocument } from "../types.js";
import { MarkdownParser } from "./markdown-parser.js";

interface MammothModule {
  convertToMarkdown(options: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
}

export class DocxParser implements Parser {
  private readonly mdParser = new MarkdownParser();

  async parse(content: Buffer | string, filename: string): Promise<ParsedDocument> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content as string);
    // Type cast justified: mammoth lacks ESM type exports — the dynamic import
    // returns the CJS module object which doesn't match the ESM default export shape.
    const mammoth = (await import("mammoth")) as unknown as MammothModule;
    const result = await mammoth.convertToMarkdown({ buffer: buf });
    return this.mdParser.parse(result.value, filename);
  }
}
