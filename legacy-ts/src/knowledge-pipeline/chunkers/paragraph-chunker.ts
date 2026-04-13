// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Paragraph Chunker
 * One chunk per paragraph. Good for FAQ-style docs.
 */

import { randomUUID } from "node:crypto";
import type { Chunker, Chunk, ChunkOptions, ParsedDocument } from "../types.js";
import { countTokens } from "../types.js";

export class ParagraphChunker implements Chunker {
  chunk(doc: ParsedDocument, options: ChunkOptions): Chunk[] {
    const now = new Date().toISOString();
    const chunks: Chunk[] = [];
    let position = 0;
    let prevContent = "";

    for (const section of doc.sections) {
      // Split section content into paragraphs
      const paragraphs = section.content
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      for (const para of paragraphs) {
        const chunk: Chunk = {
          id: randomUUID(),
          collection_id: options.collection_id,
          source_file: options.source_file,
          content: para,
          token_count: countTokens(para),
          position: position++,
          section_path: section.heading !== undefined ? [section.heading] : [],
          preceding_context: prevContent.slice(-400),
          metadata: {
            ...(section.page_number !== undefined ? { page_number: section.page_number } : {}),
          },
          created_at: now,
        };
        if (section.page_number !== undefined) {
          chunk.page_number = section.page_number;
        }
        chunks.push(chunk);
        prevContent = para;
      }
    }

    return chunks;
  }
}
