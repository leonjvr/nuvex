// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaEmbedder } from "../../../src/knowledge-pipeline/embedding/ollama-embedder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVec(dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => (i + 1) / dim);
}

function mockFetchOk(embeddings: number[][]): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ embeddings }),
  }));
}

function mockFetchError(status: number): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:         false,
    status,
    statusText: "Internal Server Error",
    text:       async () => "ollama error",
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OllamaEmbedder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct default dimensions", () => {
    const embedder = new OllamaEmbedder();
    expect(embedder.dimensions).toBe(768);
  });

  it("embeds a single text and returns Float32Array", async () => {
    const vec = makeVec();
    mockFetchOk([vec]);

    const embedder = new OllamaEmbedder();
    const result = await embedder.embed(["hello world"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(result[0]!.length).toBe(768);
  });

  it("embeds a batch of texts", async () => {
    const texts = ["alpha", "beta", "gamma"];
    mockFetchOk(texts.map(() => makeVec()));

    const embedder = new OllamaEmbedder();
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(3);
    result.forEach((r) => expect(r).toBeInstanceOf(Float32Array));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("splits >100 texts into multiple batches", async () => {
    const texts = Array.from({ length: 120 }, (_, i) => `text-${i}`);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ embeddings: Array.from({ length: 100 }, () => makeVec()) }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ embeddings: Array.from({ length: 20 }, () => makeVec()) }),
      });
    vi.stubGlobal("fetch", fetchFn);

    const embedder = new OllamaEmbedder();
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(120);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("sends request to correct endpoint with model in body", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new OllamaEmbedder({ model: "nomic-embed-text" });
    await embedder.embed(["test"]);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const url  = call[0] as string;
    const body = JSON.parse((call[1] as RequestInit).body as string) as { model: string; input: string[] };

    expect(url).toBe("http://localhost:11434/api/embed");
    expect(body.model).toBe("nomic-embed-text");
    expect(body.input).toEqual(["test"]);
  });

  it("supports custom base URL", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new OllamaEmbedder({ baseUrl: "http://remote-server:11434" });
    await embedder.embed(["test"]);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe("http://remote-server:11434/api/embed");
  });

  it("strips trailing slash from baseUrl", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new OllamaEmbedder({ baseUrl: "http://localhost:11434/" });
    await embedder.embed(["test"]);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toBe("http://localhost:11434/api/embed");
  });

  it("throws on HTTP error", async () => {
    mockFetchError(500);

    const embedder = new OllamaEmbedder();
    await expect(embedder.embed(["test"])).rejects.toThrow("500");
  });

  it("throws when response has no embeddings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ embeddings: [] }),
    }));

    const embedder = new OllamaEmbedder();
    await expect(embedder.embed(["test"])).rejects.toThrow("no embeddings");
  });
});
