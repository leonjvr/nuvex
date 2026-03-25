// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, afterEach } from "vitest";
import { GoogleEmbedder } from "../../../src/knowledge-pipeline/embedding/google-embedder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_KEY = "AIza_test_key_123";

function makeVec(dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => (i + 1) / dim);
}

function mockFetchOk(embeddings: number[][]): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ embeddings: embeddings.map((values) => ({ values })) }),
  }));
}

function mockFetchError(status: number, statusText = "Error"): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:         false,
    status,
    statusText,
    text:       async () => "api error body",
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GoogleEmbedder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct dimensions", () => {
    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    expect(embedder.dimensions).toBe(768);
  });

  it("embeds a single text and returns Float32Array", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    const result = await embedder.embed(["hello world"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(result[0]!.length).toBe(768);
  });

  it("embeds multiple texts in one batch (≤100)", async () => {
    const texts = ["alpha", "beta", "gamma"];
    mockFetchOk(texts.map(() => makeVec()));

    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(3);
    result.forEach((r) => expect(r).toBeInstanceOf(Float32Array));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("splits >100 texts into multiple batches", async () => {
    const texts = Array.from({ length: 130 }, (_, i) => `text-${i}`);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ embeddings: Array.from({ length: 100 }, () => ({ values: makeVec() })) }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ embeddings: Array.from({ length: 30 }, () => ({ values: makeVec() })) }),
      });
    vi.stubGlobal("fetch", fetchFn);

    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(130);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("sends correct URL with API key and model", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    await embedder.embed(["test"]);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const url  = call[0] as string;

    expect(url).toContain("text-embedding-004:batchEmbedContents");
    expect(url).toContain(`key=${API_KEY}`);
  });

  it("sends requests with correct structure", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    await embedder.embed(["hello"]);

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string,
    ) as { requests: { model: string; content: { parts: { text: string }[] } }[] };

    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]!.model).toBe("models/text-embedding-004");
    expect(body.requests[0]!.content.parts[0]!.text).toBe("hello");
  });

  it("supports custom model override", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new GoogleEmbedder({ apiKey: API_KEY, model: "text-embedding-005" });
    await embedder.embed(["test"]);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toContain("text-embedding-005:batchEmbedContents");
  });

  it("throws on HTTP error", async () => {
    mockFetchError(401, "Unauthorized");

    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    await expect(embedder.embed(["test"])).rejects.toThrow("401");
  });

  it("throws when response has no embeddings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ embeddings: [] }),
    }));

    const embedder = new GoogleEmbedder({ apiKey: API_KEY });
    await expect(embedder.embed(["test"])).rejects.toThrow("no embeddings");
  });
});
