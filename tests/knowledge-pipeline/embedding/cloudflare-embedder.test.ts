// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CloudflareEmbedder } from "../../../src/knowledge-pipeline/embedding/cloudflare-embedder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "test-account-id";
const API_TOKEN  = "test-api-token";

function makeVec(dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => i / dim);
}

function mockFetchOk(data: number[][]): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({
      success: true,
      result:  { shape: [data.length, 768], data },
      errors:  [],
    }),
  }));
}

function mockFetchHttpError(status: number, statusText: string): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:         false,
    status,
    statusText,
    text:       async () => "rate limit exceeded",
  }));
}

function mockFetchApiError(message: string): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({
      success: false,
      result:  { shape: [], data: [] },
      errors:  [{ message }],
    }),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CloudflareEmbedder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct dimensions", () => {
    const embedder = new CloudflareEmbedder({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    expect(embedder.dimensions).toBe(768);
  });

  it("embeds a single text and returns Float32Array", async () => {
    const vec = makeVec();
    mockFetchOk([vec]);

    const embedder = new CloudflareEmbedder({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    const result = await embedder.embed(["hello world"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(result[0]!.length).toBe(768);
  });

  it("embeds multiple texts in one batch (≤100)", async () => {
    const texts = ["alpha", "beta", "gamma"];
    const vecs  = texts.map(() => makeVec());
    mockFetchOk(vecs);

    const embedder = new CloudflareEmbedder({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(3);
    result.forEach((r) => expect(r).toBeInstanceOf(Float32Array));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("splits >100 texts into multiple batches", async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ success: true, result: { shape: [100, 768], data: Array.from({ length: 100 }, () => makeVec()) }, errors: [] }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ success: true, result: { shape: [50, 768], data: Array.from({ length: 50 }, () => makeVec()) }, errors: [] }),
      });
    vi.stubGlobal("fetch", fetchFn);

    const embedder = new CloudflareEmbedder({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    const result = await embedder.embed(texts);

    expect(result).toHaveLength(150);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("sends correct Authorization header and URL", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new CloudflareEmbedder({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    await embedder.embed(["test"]);

    const call = vi.mocked(fetch).mock.calls[0]!;
    const url  = call[0] as string;
    const init = call[1] as RequestInit;

    expect(url).toContain(ACCOUNT_ID);
    expect(url).toContain("@cf/baai/bge-base-en-v1.5");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${API_TOKEN}`);
  });

  it("supports custom model override", async () => {
    mockFetchOk([makeVec()]);

    const embedder = new CloudflareEmbedder({
      accountId: ACCOUNT_ID,
      apiToken:  API_TOKEN,
      model:     "@cf/baai/bge-large-en-v1.5",
    });
    await embedder.embed(["test"]);

    const url = vi.mocked(fetch).mock.calls[0]![0] as string;
    expect(url).toContain("@cf/baai/bge-large-en-v1.5");
  });

  it("throws on HTTP error response", async () => {
    mockFetchHttpError(429, "Too Many Requests");

    const embedder = new CloudflareEmbedder({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    await expect(embedder.embed(["test"])).rejects.toThrow("429");
  });

  it("throws on API-level error (success: false)", async () => {
    mockFetchApiError("model not found");

    const embedder = new CloudflareEmbedder({ accountId: ACCOUNT_ID, apiToken: API_TOKEN });
    await expect(embedder.embed(["test"])).rejects.toThrow("model not found");
  });
});
