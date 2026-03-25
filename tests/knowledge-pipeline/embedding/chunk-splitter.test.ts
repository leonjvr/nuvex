/**
 * Unit tests: chunk-splitter
 */

import { describe, it, expect } from "vitest";
import { chunkLimit, splitText } from "../../../src/knowledge-pipeline/embedding/chunk-splitter.js";
import { countTokens } from "../../../src/knowledge-pipeline/types.js";

describe("chunkLimit()", () => {
  it("returns 50% of maxTokens (floor)", () => {
    expect(chunkLimit(8191)).toBe(4095);
    expect(chunkLimit(512)).toBe(256);
    expect(chunkLimit(100)).toBe(50);
    expect(chunkLimit(10)).toBe(5);
  });
});

describe("splitText()", () => {
  it("returns single-element array when text fits", () => {
    const text = "Short text that fits easily.";
    const result = splitText(text, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("splits at paragraph boundaries", () => {
    const para1 = "First paragraph with some content here and there.";
    const para2 = "Second paragraph with different content and ideas.";
    // Build a text that together exceeds a small limit but each para fits
    const text = `${para1}\n\n${para2}`;
    // countTokens(text) ≈ 18-20; set limit to 14 to force split
    const result = splitText(text, 14);
    expect(result.length).toBeGreaterThan(1);
    // Each part must fit within limit
    for (const part of result) {
      expect(countTokens(part)).toBeLessThanOrEqual(14);
    }
  });

  it("all parts fit within the limit", () => {
    // Generate a longer text (many paragraphs)
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph number ${i + 1} contains several words about various topics such as science technology and art.`
    );
    const text = paragraphs.join("\n\n");
    const limit = 20;
    const parts = splitText(text, limit);
    for (const part of parts) {
      expect(countTokens(part)).toBeLessThanOrEqual(limit);
    }
  });

  it("total content is preserved (no text lost)", () => {
    const text = "Hello world. This is a test. Split me into parts.\n\nSecond para here.\n\nThird paragraph.";
    const limit = 10;
    const parts = splitText(text, limit);
    // Reassembled content should contain all words
    const allWords = text.split(/\s+/).filter(Boolean).sort();
    const reassembled = parts.join(" ").split(/\s+/).filter(Boolean).sort();
    expect(reassembled).toEqual(allWords);
  });

  it("handles text with no paragraph breaks", () => {
    const longSentence = "word ".repeat(200).trim();
    const limit = 30;
    const parts = splitText(longSentence, limit);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(countTokens(part)).toBeLessThanOrEqual(limit);
    }
  });

  it("returns at least one non-empty part", () => {
    const result = splitText("single", 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBeTruthy();
  });
});
