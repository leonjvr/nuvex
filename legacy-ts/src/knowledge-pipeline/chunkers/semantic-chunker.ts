// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: Semantic Chunker
 * Structure-aware: splits at heading/section boundaries.
 * Respects sentence boundaries. Target chunk_size_tokens ± 20%.
 */

import { randomUUID } from "node:crypto";
import type { Chunker, Chunk, ChunkOptions, ParsedDocument, ParsedSection } from "../types.js";
import { countTokens } from "../types.js";

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 50;
const TOLERANCE = 0.20;

export class SemanticChunker implements Chunker {
  chunk(doc: ParsedDocument, options: ChunkOptions): Chunk[] {
    const targetSize = options.chunk_size_tokens ?? DEFAULT_CHUNK_SIZE;
    const overlapTokens = options.chunk_overlap_tokens ?? DEFAULT_OVERLAP;
    const maxSize = Math.ceil(targetSize * (1 + TOLERANCE));

    const chunks: Chunk[] = [];
    const now = new Date().toISOString();
    const sectionPath: string[] = [];

    for (const section of doc.sections) {
      // Update section path for heading sections
      if (section.heading !== undefined) {
        const level = section.level ?? 1;
        sectionPath.splice(level - 1);
        sectionPath[level - 1] = section.heading;
      }

      // Split section content into sentences
      const sentences = this._splitSentences(section.content);
      let currentTokens = 0;
      let currentSentences: string[] = [];
      let overlapBuffer: string[] = [];

      const flush = (isLast: boolean) => {
        if (currentSentences.length === 0) return;
        const content = currentSentences.join(" ").trim();
        if (content.length === 0) return;

        const precedingContext = overlapBuffer.join(" ").trim().slice(-400);
        const chunk: Chunk = {
          id: randomUUID(),
          collection_id: options.collection_id,
          source_file: options.source_file,
          content,
          token_count: countTokens(content),
          position: chunks.length,
          section_path: [...sectionPath].filter(Boolean),
          preceding_context: precedingContext,
          metadata: {
            ...(section.page_number !== undefined ? { page_number: section.page_number } : {}),
            ...(section.heading !== undefined ? { section_heading: section.heading } : {}),
          },
          created_at: now,
        };
        if (section.page_number !== undefined) {
          chunk.page_number = section.page_number;
        }
        chunks.push(chunk);

        // Compute overlap for next chunk
        overlapBuffer = [];
        let overlapCount = 0;
        for (let i = currentSentences.length - 1; i >= 0; i--) {
          const s = currentSentences[i]!;
          overlapCount += countTokens(s);
          if (overlapCount > overlapTokens) break;
          overlapBuffer.unshift(s);
        }
        currentSentences = [...overlapBuffer];
        currentTokens = currentSentences.length > 0
          ? countTokens(currentSentences.join(" "))
          : 0;
      };

      for (const sentence of sentences) {
        // Use countTokens on the joined candidate to stay consistent with what
        // gets stored in token_count (joining adds spaces → char-based estimate
        // can differ from the sum of individual sentence estimates).
        const candidateContent = currentSentences.length > 0
          ? currentSentences.join(" ") + " " + sentence
          : sentence;
        const candidateTokens = countTokens(candidateContent);
        // Flush whenever adding this sentence would exceed maxSize, as long as
        // there is already content to flush. Single sentences that individually
        // exceed maxSize are left for _expandChunks (EmbeddingPipeline) to split.
        if (candidateTokens > maxSize && currentSentences.length > 0) {
          flush(false);
        }
        currentSentences.push(sentence);
        currentTokens = countTokens(currentSentences.join(" "));
      }
      flush(true);
    }

    return chunks;
  }

  private _splitSentences(text: string): string[] {
    // Split on sentence boundaries: ., !, ? followed by space + capital
    const raw = text.split(/(?<=[.!?])\s+(?=[A-Z"'\(])/).filter((s) => s.trim().length > 0);
    if (raw.length === 0 && text.trim().length > 0) return [text.trim()];
    return raw;
  }
}
