/**
 * Unit tests: FixedChunker
 */

import { describe, it, expect } from "vitest";
import { FixedChunker } from "../../../src/knowledge-pipeline/chunkers/fixed-chunker.js";
import type { ParsedDocument, ChunkOptions } from "../../../src/knowledge-pipeline/types.js";
import { countTokens } from "../../../src/knowledge-pipeline/types.js";

const BASE_OPTIONS: ChunkOptions = {
  collection_id: "col-fixed",
  source_file: "source.txt",
  chunk_size_tokens: 50,
  chunk_overlap_tokens: 10,
};

function makeDoc(content: string): ParsedDocument {
  return {
    sections: [{ content }],
    source_file: "source.txt",
    total_tokens: countTokens(content),
  };
}

describe("FixedChunker", () => {
  const chunker = new FixedChunker();

  it("splits large content into multiple chunks of approximately target size", () => {
    // Build ~300 token content with a 50-token target to force splits
    const word = "token";
    // ~300 words ~ 400 tokens at 1.33x ratio
    const largeContent = Array.from({ length: 300 }, (_, i) => `${word}${i}`).join(" ");

    const doc = makeDoc(largeContent);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk token count should be in a reasonable range
    for (const chunk of chunks) {
      expect(chunk.token_count).toBeGreaterThan(0);
    }
  });

  it("small content that fits within target size returns single chunk", () => {
    const smallContent = "This is a short sentence.";
    const doc = makeDoc(smallContent);

    const chunks = chunker.chunk(doc, {
      ...BASE_OPTIONS,
      chunk_size_tokens: 500,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("short sentence");
  });

  it("overlap produces preceding_context on non-first chunks", () => {
    const word = "word";
    // ~200 words to force multiple chunks with 50-token target
    const largeContent = Array.from({ length: 200 }, (_, i) => `${word}${i}`).join(" ");

    const doc = makeDoc(largeContent);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(1);
    const nonFirstChunks = chunks.slice(1);
    for (const chunk of nonFirstChunks) {
      expect(chunk.preceding_context.length).toBeGreaterThan(0);
    }
  });

  it("first chunk has empty preceding_context", () => {
    const word = "item";
    const largeContent = Array.from({ length: 150 }, (_, i) => `${word}${i}`).join(" ");

    const doc = makeDoc(largeContent);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.preceding_context).toBe("");
  });

  it("position values are sequential starting at 0", () => {
    const word = "pos";
    const largeContent = Array.from({ length: 150 }, (_, i) => `${word}${i}`).join(" ");

    const doc = makeDoc(largeContent);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, idx) => {
      expect(chunk.position).toBe(idx);
    });
  });

  it("each chunk has a unique id", () => {
    const word = "unique";
    const largeContent = Array.from({ length: 200 }, (_, i) => `${word}${i}`).join(" ");

    const doc = makeDoc(largeContent);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(1);
    const ids = chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("collection_id and source_file are set from options", () => {
    const doc = makeDoc("Hello world. This is some content.");
    const chunks = chunker.chunk(doc, {
      collection_id: "my-collection",
      source_file: "my-source.txt",
      chunk_size_tokens: 500,
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.collection_id).toBe("my-collection");
      expect(chunk.source_file).toBe("my-source.txt");
    }
  });

  it("combines content from multiple sections into a single stream", () => {
    const doc: ParsedDocument = {
      sections: [
        { content: "Section alpha content words." },
        { content: "Section beta content words." },
      ],
      source_file: "multi.txt",
      total_tokens: 10,
    };

    const chunks = chunker.chunk(doc, {
      ...BASE_OPTIONS,
      chunk_size_tokens: 500,
    });

    expect(chunks.length).toBeGreaterThan(0);
    const allContent = chunks.map((c) => c.content).join(" ");
    expect(allContent).toContain("alpha");
    expect(allContent).toContain("beta");
  });
});
