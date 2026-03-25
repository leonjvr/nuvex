/**
 * Unit tests: ParagraphChunker
 */

import { describe, it, expect } from "vitest";
import { ParagraphChunker } from "../../../src/knowledge-pipeline/chunkers/paragraph-chunker.js";
import type { ParsedDocument, ChunkOptions } from "../../../src/knowledge-pipeline/types.js";
import { countTokens } from "../../../src/knowledge-pipeline/types.js";

const BASE_OPTIONS: ChunkOptions = {
  collection_id: "col-para",
  source_file: "doc.md",
};

function makeDoc(sections: ParsedDocument["sections"]): ParsedDocument {
  return {
    sections,
    source_file: "doc.md",
    total_tokens: sections.reduce((sum, s) => sum + countTokens(s.content), 0),
  };
}

describe("ParagraphChunker", () => {
  const chunker = new ParagraphChunker();

  it("splits content on double newlines into multiple chunks", () => {
    const content = [
      "First paragraph with some words.",
      "",
      "Second paragraph with different words.",
      "",
      "Third paragraph concludes the section.",
    ].join("\n");

    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.content).toContain("First paragraph");
    expect(chunks[1]!.content).toContain("Second paragraph");
    expect(chunks[2]!.content).toContain("Third paragraph");
  });

  it("single paragraph with no double newlines returns single chunk", () => {
    const content = "This is one paragraph. It has multiple sentences but no double newlines.";

    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("one paragraph");
  });

  it("multiple paragraphs across multiple sections return multiple chunks", () => {
    const doc = makeDoc([
      {
        content: "Intro paragraph one.\n\nIntro paragraph two.",
        heading: "Intro",
      },
      {
        content: "Body paragraph one.\n\nBody paragraph two.",
        heading: "Body",
      },
    ]);

    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks).toHaveLength(4);
  });

  it("preceding_context is empty for the first chunk", () => {
    const content = "First.\n\nSecond.\n\nThird.";
    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.preceding_context).toBe("");
  });

  it("preceding_context is populated on non-first chunks", () => {
    const content = "Paragraph one text here.\n\nParagraph two text here.\n\nParagraph three text here.";
    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(1);
    const nonFirstChunks = chunks.slice(1);
    for (const chunk of nonFirstChunks) {
      expect(chunk.preceding_context.length).toBeGreaterThan(0);
    }
  });

  it("section_path is set from section heading", () => {
    const doc = makeDoc([
      {
        content: "Content under a named section.",
        heading: "My Section",
      },
    ]);

    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.section_path).toContain("My Section");
    }
  });

  it("section_path is empty when section has no heading", () => {
    const doc = makeDoc([{ content: "Content without a heading." }]);

    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.section_path).toHaveLength(0);
    }
  });

  it("position values are sequential starting at 0", () => {
    const content = "Para one.\n\nPara two.\n\nPara three.\n\nPara four.";
    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBe(4);
    chunks.forEach((chunk, idx) => {
      expect(chunk.position).toBe(idx);
    });
  });

  it("each chunk has a unique id", () => {
    const content = "Alpha.\n\nBeta.\n\nGamma.\n\nDelta.";
    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    const ids = chunks.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("token_count is greater than 0 for non-empty paragraphs", () => {
    const content = "This paragraph has several words in it.";
    const doc = makeDoc([{ content }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.token_count).toBeGreaterThan(0);
    }
  });

  it("page_number is propagated from section to chunk", () => {
    const doc = makeDoc([
      {
        content: "A paragraph on page three.",
        page_number: 3,
      },
    ]);

    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.page_number).toBe(3);
    }
  });

  it("empty sections produce no chunks", () => {
    const doc = makeDoc([{ content: "" }, { content: "   " }]);
    const chunks = chunker.chunk(doc, BASE_OPTIONS);

    expect(chunks).toHaveLength(0);
  });
});
