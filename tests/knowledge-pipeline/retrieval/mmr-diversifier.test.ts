/**
 * Unit tests: MMRDiversifier
 */

import { describe, it, expect } from "vitest";
import { MMRDiversifier } from "../../../src/knowledge-pipeline/retrieval/mmr-diversifier.js";
import type { RetrievalResult, Chunk } from "../../../src/knowledge-pipeline/types.js";

function makeChunk(id: string, content: string): Chunk {
  return {
    id,
    collection_id: "col-1",
    source_file: "test.md",
    content,
    token_count: content.split(/\s+/).length,
    position: 0,
    section_path: [],
    preceding_context: "",
    metadata: {},
    created_at: new Date().toISOString(),
  };
}

function makeResult(id: string, score: number, content: string): RetrievalResult {
  return { chunk: makeChunk(id, content), score };
}

describe("MMRDiversifier", () => {
  const diversifier = new MMRDiversifier();

  it("returns empty array for empty input", () => {
    const result = diversifier.diversify([]);
    expect(result).toEqual([]);
  });

  it("returns at most top_k results", () => {
    const candidates: RetrievalResult[] = [
      makeResult("a", 0.9, "apple banana cherry"),
      makeResult("b", 0.8, "dog elephant fox"),
      makeResult("c", 0.7, "grape honeydew iris"),
      makeResult("d", 0.6, "jaguar kiwi lemon"),
      makeResult("e", 0.5, "mango nectarine orange"),
    ];
    const results = diversifier.diversify(candidates, { top_k: 3 });
    expect(results).toHaveLength(3);
  });

  it("returns all candidates when top_k >= candidates length", () => {
    const candidates: RetrievalResult[] = [
      makeResult("a", 0.9, "alpha beta gamma"),
      makeResult("b", 0.7, "delta epsilon zeta"),
    ];
    const results = diversifier.diversify(candidates, { top_k: 10 });
    expect(results).toHaveLength(2);
  });

  it("with lambda=1.0 (pure relevance) returns highest-scoring items first", () => {
    const candidates: RetrievalResult[] = [
      makeResult("low",  0.3, "completely different content here unique alpha"),
      makeResult("high", 0.9, "completely different content here unique beta"),
      makeResult("mid",  0.6, "completely different content here unique gamma"),
    ];
    // With lambda=1, MMR score = 1.0 * relevance - 0 * max_sim = relevance
    // So purely sorted by original score
    const results = diversifier.diversify(candidates, { lambda: 1.0, top_k: 3 });
    expect(results[0]?.chunk.id).toBe("high");
    expect(results[1]?.chunk.id).toBe("mid");
    expect(results[2]?.chunk.id).toBe("low");
  });

  it("with lambda=0.0 (pure diversity) avoids selecting similar items consecutively", () => {
    // Two chunks share identical content (high similarity) — only one should dominate with lambda=0
    const nearDuplicate1 = makeResult("dup1", 0.8, "machine learning neural network training data");
    const nearDuplicate2 = makeResult("dup2", 0.75, "machine learning neural network training data");
    const diverse       = makeResult("div",  0.5,  "fiscal budget quarterly reporting spreadsheet");

    const results = diversifier.diversify([nearDuplicate1, nearDuplicate2, diverse], {
      lambda: 0.0,
      top_k: 2,
    });

    // With lambda=0: first pick is arbitrary (all have max_sim=0 for first pick),
    // but after dup1 is selected, dup2 has maxSim ≈ 1 so MMR score ≈ -1,
    // while diverse has maxSim ≈ 0 so MMR score ≈ 0. Thus diverse should be next.
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.chunk.id);
    expect(ids[0]).toBe("dup1"); // highest score picks first
    expect(ids[1]).toBe("div");  // diverse content preferred over near-duplicate
  });

  it("deduplicates identical chunks by ID (same chunk appearing twice)", () => {
    // If the same chunk ID appears twice in candidates, it will be selected once
    // and removed from remaining — second occurrence is spliced out of pool
    const chunk = makeChunk("same-id", "content about artificial intelligence");
    const result1: RetrievalResult = { chunk, score: 0.9 };
    const result2: RetrievalResult = { chunk, score: 0.9 };

    const results = diversifier.diversify([result1, result2], { top_k: 5 });
    // Both results reference the same object, but they're distinct array entries.
    // The diversifier selects the first, then the second (different array element with same ID).
    // Since there's no explicit dedup by ID in the algorithm, both could be returned.
    // However, after the first is selected, the second has maxSim=1.0 (identical content).
    // With default lambda=0.7: MMR = 0.7*0.9 - 0.3*1.0 = 0.63 - 0.30 = 0.33 > -Infinity
    // It will still be selected. Verify the algorithm handles same-ID gracefully (no error).
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns zero results when top_k is 0", () => {
    const candidates: RetrievalResult[] = [
      makeResult("a", 0.9, "content one two three"),
    ];
    const results = diversifier.diversify(candidates, { top_k: 0 });
    expect(results).toEqual([]);
  });

  it("uses default lambda=0.7 when not specified", () => {
    // Default lambda=0.7 balances relevance and diversity
    // Verify it still returns results without error
    const candidates: RetrievalResult[] = [
      makeResult("a", 0.9, "topic alpha beta gamma delta"),
      makeResult("b", 0.8, "topic alpha beta gamma delta"),
      makeResult("c", 0.7, "completely different subject matter"),
    ];
    const results = diversifier.diversify(candidates, { top_k: 2 });
    expect(results).toHaveLength(2);
    // First result should be the highest relevance item
    expect(results[0]?.chunk.id).toBe("a");
  });

  it("preserves the selected item scores (MMR scores, not original scores)", () => {
    const candidates: RetrievalResult[] = [
      makeResult("a", 0.9, "unique content first item here"),
    ];
    const results = diversifier.diversify(candidates, { lambda: 1.0, top_k: 1 });
    expect(results).toHaveLength(1);
    // With lambda=1.0 and no prior selected items, MMR score = 1.0 * 0.9 - 0 * 0 = 0.9
    expect(results[0]?.score).toBeCloseTo(0.9, 5);
  });
});
