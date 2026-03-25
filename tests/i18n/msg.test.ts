/**
 * Unit tests: i18n msg() / t() function — updated for P190 flat JSON approach
 */

import { describe, it, expect, beforeEach } from "vitest";
import { msg, t, getLocale, rawMessages, clearLocaleCache } from "../../src/i18n/index.js";

beforeEach(() => {
  clearLocaleCache();
});

describe("msg() / t() — flat JSON locale", () => {
  it("returns correct string for a valid dot-path", () => {
    const result = msg("memory.search.no_results", { query: "MOODEX patent" });
    expect(result).toBe('No results found for: "MOODEX patent"');
  });

  it("interpolates multiple variables", () => {
    const result = msg("memory.search.results_header", { query: "test", count: 5 });
    expect(result).toBe('Search results for: "test" (5 found)');
  });

  it("returns the key itself for unknown path (graceful fallback)", () => {
    const result = msg("does.not.exist");
    expect(result).toBe("does.not.exist");
  });

  it("returns string as-is when no vars provided", () => {
    const result = msg("memory.import.ingesting");
    expect(result).toBe("Ingesting into knowledge pipeline...");
  });

  it("leaves unmatched placeholder as-is", () => {
    const result = msg("memory.search.no_results", { wrong_key: "foo" });
    expect(result).toBe('No results found for: "{query}"');
  });

  it("handles numeric vars", () => {
    const result = msg("memory.search.results_header", { query: "test", count: 42 });
    expect(result).toContain("42 found");
  });

  it("t() is an alias for msg()", () => {
    expect(t("memory.import.ingesting")).toBe(msg("memory.import.ingesting"));
  });

  it("getLocale() returns 'en'", () => {
    expect(getLocale()).toBe("en");
  });

  it("rawMessages has flat key structure", () => {
    expect(rawMessages).toHaveProperty("memory.search.no_results");
    expect(rawMessages).toHaveProperty("startup.embedder_hint_openai");
    expect(rawMessages).toHaveProperty("errors.embedding_failed");
  });

  it("en.json has memory.embedder.fallback_bm25 message", () => {
    const result = msg("memory.embedder.fallback_bm25");
    expect(result).toContain("BM25");
    expect(result).toContain("OPENAI_API_KEY");
  });

  it("startup.embedder_hint_openai interpolates model and dimensions", () => {
    const result = msg("startup.embedder_hint_openai", { model: "text-embedding-3-large", dimensions: "3072" });
    expect(result).toContain("text-embedding-3-large");
    expect(result).toContain("3072");
  });
});
