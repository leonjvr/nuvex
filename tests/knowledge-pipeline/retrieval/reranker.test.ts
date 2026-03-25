/**
 * Unit tests: Reranker
 */

import { describe, it, expect } from "vitest";
import { Reranker } from "../../../src/knowledge-pipeline/retrieval/reranker.js";
import type { RetrievalResult, Chunk } from "../../../src/knowledge-pipeline/types.js";

function makeChunk(id: string, content = "chunk content"): Chunk {
  return {
    id,
    collection_id: "col-1",
    source_file: "test.md",
    content,
    token_count: 10,
    position: 0,
    section_path: [],
    preceding_context: "",
    metadata: {},
    created_at: new Date().toISOString(),
  };
}

function makeResult(id: string, score: number): RetrievalResult {
  return { chunk: makeChunk(id), score };
}

describe("Reranker", () => {
  const reranker = new Reranker();

  it("returns empty array for empty input", () => {
    const result = reranker.rerank([]);
    expect(result).toEqual([]);
  });

  it("filters out results below threshold", () => {
    const input: RetrievalResult[] = [
      makeResult("a", 0.9),
      makeResult("b", 0.3),
      makeResult("c", 0.5),
      makeResult("d", 0.1),
    ];
    const results = reranker.rerank(input, { threshold: 0.4 });
    const ids = results.map((r) => r.chunk.id);
    expect(ids).not.toContain("b");
    expect(ids).not.toContain("d");
    expect(ids).toContain("a");
    expect(ids).toContain("c");
  });

  it("returns all results when no threshold is specified (default 0.0)", () => {
    const input: RetrievalResult[] = [
      makeResult("a", 0.9),
      makeResult("b", 0.0),
      makeResult("c", 0.5),
    ];
    const results = reranker.rerank(input);
    expect(results).toHaveLength(3);
  });

  it("returns results sorted by score descending", () => {
    const input: RetrievalResult[] = [
      makeResult("a", 0.3),
      makeResult("b", 0.9),
      makeResult("c", 0.6),
    ];
    const results = reranker.rerank(input);
    expect(results[0]?.chunk.id).toBe("b");
    expect(results[1]?.chunk.id).toBe("c");
    expect(results[2]?.chunk.id).toBe("a");
  });

  it("respects the top_k limit", () => {
    const input: RetrievalResult[] = [
      makeResult("a", 0.9),
      makeResult("b", 0.8),
      makeResult("c", 0.7),
      makeResult("d", 0.6),
      makeResult("e", 0.5),
    ];
    const results = reranker.rerank(input, { top_k: 3 });
    expect(results).toHaveLength(3);
    expect(results[0]?.chunk.id).toBe("a");
    expect(results[1]?.chunk.id).toBe("b");
    expect(results[2]?.chunk.id).toBe("c");
  });

  it("applies both threshold and top_k together", () => {
    const input: RetrievalResult[] = [
      makeResult("a", 0.95),
      makeResult("b", 0.85),
      makeResult("c", 0.75),
      makeResult("d", 0.20),
      makeResult("e", 0.10),
    ];
    const results = reranker.rerank(input, { threshold: 0.5, top_k: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]?.chunk.id).toBe("a");
    expect(results[1]?.chunk.id).toBe("b");
  });

  it("returns empty array when all results are below threshold", () => {
    const input: RetrievalResult[] = [
      makeResult("a", 0.1),
      makeResult("b", 0.2),
    ];
    const results = reranker.rerank(input, { threshold: 0.5 });
    expect(results).toEqual([]);
  });

  it("keeps result exactly at the threshold boundary", () => {
    const input: RetrievalResult[] = [
      makeResult("a", 0.5),
      makeResult("b", 0.499),
    ];
    const results = reranker.rerank(input, { threshold: 0.5 });
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk.id).toBe("a");
  });
});
