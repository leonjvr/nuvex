/**
 * Unit tests: SemanticChunker
 */

import { describe, it, expect } from "vitest";
import { SemanticChunker } from "../../../src/knowledge-pipeline/chunkers/semantic-chunker.js";
import type { ParsedDocument, ChunkOptions } from "../../../src/knowledge-pipeline/types.js";
import { countTokens } from "../../../src/knowledge-pipeline/types.js";

const BASE_OPTIONS: ChunkOptions = {
  collection_id: "col-test",
  source_file: "test.md",
  chunk_size_tokens: 100,
  chunk_overlap_tokens: 10,
};

function makeDoc(sections: ParsedDocument["sections"]): ParsedDocument {
  return {
    sections,
    source_file: "test.md",
    total_tokens: sections.reduce((sum, s) => sum + countTokens(s.content), 0),
  };
}

describe("SemanticChunker", () => {
  const chunker = new SemanticChunker();

  it("returns empty array for empty document", () => {
    const doc = makeDoc([]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks).toHaveLength(0);
  });

  it("chunks document respecting heading section boundaries", () => {
    // Two heading sections with distinct content
    const doc = makeDoc([
      {
        content: "This is the introduction section. It describes the overview of the topic.",
        heading: "Introduction",
        level: 1,
      },
      {
        content: "This is the conclusion section. It wraps up the discussion and summarizes.",
        heading: "Conclusion",
        level: 1,
      },
    ]);

    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // All chunks should have valid ids, collection_id, source_file
    for (const chunk of chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.collection_id).toBe("col-test");
      expect(chunk.source_file).toBe("test.md");
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("respects target token size within ±20% tolerance", () => {
    // Build content that is clearly larger than target to force splits
    const sentence = "The quick brown fox jumped over the lazy dog near the riverbank.";
    // Repeat to get well beyond target size
    const longContent = Array.from({ length: 20 }, () => sentence).join(" ");

    const targetSize = 50;
    const doc = makeDoc([{ content: longContent }]);
    const chunks = chunker.chunk(doc, {
      ...BASE_OPTIONS,
      chunk_size_tokens: targetSize,
      chunk_overlap_tokens: 5,
    });

    expect(chunks.length).toBeGreaterThan(1);
    const maxAllowed = Math.ceil(targetSize * 1.20);
    for (const chunk of chunks) {
      expect(chunk.token_count).toBeLessThanOrEqual(maxAllowed);
    }
  });

  it("overlap: preceding_context is populated on non-first chunks", () => {
    // Use very short sentences (2-3 words each) so they fit inside the overlap window.
    // countTokens("Go now.") = ceil(2 * 1.33) = 3 tokens, well within overlap_tokens=20.
    const shortSentences = Array.from({ length: 60 }, (_, i) => `Go now ${i}.`);
    const longContent = shortSentences.join(" ");

    const doc = makeDoc([{ content: longContent }]);
    const chunks = chunker.chunk(doc, {
      ...BASE_OPTIONS,
      chunk_size_tokens: 40,
      chunk_overlap_tokens: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
    // Non-first chunks should have preceding_context populated from the overlap buffer
    const nonFirstChunks = chunks.slice(1);
    for (const chunk of nonFirstChunks) {
      expect(chunk.preceding_context.length).toBeGreaterThan(0);
    }
  });

  it("assigns section_path based on heading hierarchy", () => {
    const doc = makeDoc([
      {
        content: "Top-level introduction to the chapter.",
        heading: "Chapter One",
        level: 1,
      },
      {
        content: "A subsection within chapter one.",
        heading: "Section 1.1",
        level: 2,
      },
    ]);

    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThanOrEqual(1);

    const chapterChunks = chunks.filter((c) => c.section_path.includes("Chapter One"));
    expect(chapterChunks.length).toBeGreaterThan(0);

    const subsectionChunks = chunks.filter((c) => c.section_path.includes("Section 1.1"));
    expect(subsectionChunks.length).toBeGreaterThan(0);
  });

  it("position values are sequential starting at 0", () => {
    const content = "This section has enough content to produce at least one chunk from the chunker.";
    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((chunk, idx) => {
      expect(chunk.position).toBe(idx);
    });
  });

  it("each chunk has a unique id", () => {
    const sentence = "Generating unique IDs for every chunk produced by the semantic chunker.";
    const longContent = Array.from({ length: 20 }, () => sentence).join(" ");

    const doc = makeDoc([{ content: longContent }]);
    const chunks = chunker.chunk(doc, {
      ...BASE_OPTIONS,
      chunk_size_tokens: 50,
      chunk_overlap_tokens: 5,
    });

    const ids = chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("page_number is propagated from section to chunk", () => {
    const doc = makeDoc([
      {
        content: "Page two content. More words here to fill the chunk.",
        page_number: 2,
      },
    ]);

    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.page_number).toBe(2);
    }
  });
});
