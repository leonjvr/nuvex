// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Fixed Chunker
 * Token-count based splitting with simple overlap.
 */

import { randomUUID } from "node:crypto";
import type { Chunker, Chunk, ChunkOptions, ParsedDocument } from "../types.js";
import { countTokens } from "../types.js";

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 50;

export class FixedChunker implements Chunker {
  chunk(doc: ParsedDocument, options: ChunkOptions): Chunk[] {
    const targetSize = options.chunk_size_tokens ?? DEFAULT_CHUNK_SIZE;
    const overlapSize = options.chunk_overlap_tokens ?? DEFAULT_OVERLAP;
    const now = new Date().toISOString();

    // Combine all section text
    const fullText = doc.sections.map((s) => s.content).join("\n\n");
    const words = fullText.split(/\s+/).filter((w) => w.length > 0);

    const chunks: Chunk[] = [];
    // Approximate: 1 word ≈ 1.33 tokens, so words per chunk = targetSize / 1.33
    const wordsPerChunk = Math.max(1, Math.floor(targetSize / 1.33));
    const overlapWords = Math.floor(overlapSize / 1.33);

    let position = 0;
    for (let start = 0; start < words.length; start += wordsPerChunk - overlapWords) {
      const end = Math.min(start + wordsPerChunk, words.length);
      const content = words.slice(start, end).join(" ");
      if (content.length === 0) break;

      const precedingContent = start > 0 ? words.slice(Math.max(0, start - overlapWords), start).join(" ") : "";

      chunks.push({
        id: randomUUID(),
        collection_id: options.collection_id,
        source_file: options.source_file,
        content,
        token_count: countTokens(content),
        position: position++,
        section_path: [],
        preceding_context: precedingContent,
        metadata: {},
        created_at: now,
      });

      if (end >= words.length) break;
    }

    return chunks;
  }
}
