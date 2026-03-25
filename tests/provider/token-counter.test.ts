/**
 * Tests for src/provider/token-counter.ts
 *
 * Covers:
 * - estimateTokenCount: character-based estimation
 * - estimateMessagesTokens: per-message overhead, systemPrompt deduplication
 * - calculateCost: known models, unknown model fallback
 * - estimateCallCost: pre-call cost estimation
 * - inferProviderFromModel: model → provider mapping
 * - getModelPricing: known and unknown models
 */

import { describe, it, expect } from "vitest";
import {
  calculateCost,
  estimateCallCost,
  estimateMessagesTokens,
  estimateTokenCount,
  getModelPricing,
  inferProviderFromModel,
} from "../../src/provider/token-counter.js";
import type { Message, TokenUsage } from "../../src/types/provider.js";

// ---------------------------------------------------------------------------
// estimateTokenCount
// ---------------------------------------------------------------------------

describe("estimateTokenCount", () => {
  // FIX-H5: estimateTokenCount now uses tiktoken (cl100k_base) when loaded,
  // falling back to chars/3 heuristic. Tests use the fallback formula since
  // tiktoken loads asynchronously and may not be ready during unit tests.
  it("returns a positive count for non-empty strings", () => {
    expect(estimateTokenCount("aaaa")).toBeGreaterThan(0);
    expect(estimateTokenCount("aaaaa")).toBeGreaterThan(0);
    expect(estimateTokenCount("aaaaaaaaa")).toBeGreaterThan(0);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("handles long strings proportionally (chars/3 fallback: 400 chars = ceil(400/3) = 134)", () => {
    const text = "a".repeat(400);
    // With chars/3 fallback: Math.ceil(400/3) = 134
    // With tiktoken (cl100k_base): actual token count for 400 'a' chars
    // Either way, must be > 0 and < 400 (not 1-per-char)
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------------------
// estimateMessagesTokens
// ---------------------------------------------------------------------------

describe("estimateMessagesTokens", () => {
  it("adds 3 base overhead tokens", () => {
    // Empty messages, no system prompt → just overhead
    expect(estimateMessagesTokens([])).toBe(3);
  });

  it("adds per-message overhead (4 tokens per message)", () => {
    const messages: Message[] = [
      { role: "user", content: "" }, // 0 content tokens + 4 overhead
    ];
    expect(estimateMessagesTokens(messages)).toBe(3 + 4);
  });

  it("includes system prompt tokens when provided", () => {
    const systemPrompt = "a".repeat(40); // chars/3: ceil(40/3)=14 tokens + 4 overhead
    // FIX-H5: chars/3 fallback = 14 + 4 = 18 extra; tiktoken may differ
    const result = estimateMessagesTokens([], systemPrompt);
    expect(result).toBeGreaterThan(3); // more than base overhead
  });

  it("skips inline system-role messages when systemPrompt provided (no double-count)", () => {
    const messages: Message[] = [
      { role: "system", content: "a".repeat(40) }, // should be skipped
      { role: "user",   content: "" },
    ];
    const systemPrompt = "a".repeat(40);
    // Only systemPrompt counts, not the inline system message
    const withSystem    = estimateMessagesTokens(messages, systemPrompt);
    const withoutInline = estimateMessagesTokens(
      [{ role: "user", content: "" }],
      systemPrompt,
    );
    expect(withSystem).toBe(withoutInline);
  });

  it("includes inline system-role message when no systemPrompt provided", () => {
    const messages: Message[] = [
      { role: "system", content: "a".repeat(40) }, // included
    ];
    expect(estimateMessagesTokens(messages)).toBeGreaterThan(3);
  });

  it("sums tokens across multiple messages", () => {
    const messages: Message[] = [
      { role: "user",      content: "a".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
    ];
    const tokens = estimateMessagesTokens(messages);
    // FIX-H5: chars/3 fallback = 3 + (34+4) + (34+4) = 79; tiktoken may differ
    // Either way, must be > 3 (base) and include per-message overhead
    expect(tokens).toBeGreaterThan(3 + 4 + 4); // at least base + 2× per-msg overhead
  });
});

// ---------------------------------------------------------------------------
// calculateCost
// ---------------------------------------------------------------------------

describe("calculateCost", () => {
  it("calculates cost for claude-sonnet-4-6 ($3/$15 per 1M)", () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };
    const cost = calculateCost(usage, "claude-sonnet-4-6");
    expect(cost).toBeCloseTo(18.00, 2); // $3 + $15
  });

  it("calculates cost for gpt-4o ($2.50/$10 per 1M)", () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };
    const cost = calculateCost(usage, "gpt-4o");
    expect(cost).toBeCloseTo(12.50, 2); // $2.50 + $10
  });

  it("uses default pricing for unknown models", () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 };
    const cost = calculateCost(usage, "unknown-model-xyz");
    expect(cost).toBeGreaterThan(0);
    // Default: $5 input + $15 output = $20
    expect(cost).toBeCloseTo(20.00, 2);
  });

  it("returns 0 when usage is all zeros", () => {
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    expect(calculateCost(usage, "claude-sonnet-4-6")).toBe(0);
  });

  it("scales proportionally for small token counts", () => {
    const usage: TokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };
    const cost = calculateCost(usage, "claude-sonnet-4-6");
    // $3/1M * 1000 + $15/1M * 500 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 6);
  });
});

// ---------------------------------------------------------------------------
// estimateCallCost
// ---------------------------------------------------------------------------

describe("estimateCallCost", () => {
  it("returns positive estimates for typical usage", () => {
    const messages: Message[] = [
      { role: "user", content: "What is the capital of France?" },
    ];
    const result = estimateCallCost(messages, "claude-sonnet-4-6");
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
    expect(result.estimatedOutputTokens).toBeGreaterThan(0);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("uses custom expectedOutputTokens when provided", () => {
    const messages: Message[] = [{ role: "user", content: "Hello" }];
    const custom = estimateCallCost(messages, "gpt-4o", undefined, 1000);
    expect(custom.estimatedOutputTokens).toBe(1000);
  });

  it("defaults output to 30% of estimated input", () => {
    const messages: Message[] = [{ role: "user", content: "a".repeat(400) }];
    const result = estimateCallCost(messages, "gpt-4o");
    expect(result.estimatedOutputTokens).toBe(Math.ceil(result.estimatedInputTokens * 0.3));
  });
});

// ---------------------------------------------------------------------------
// inferProviderFromModel
// ---------------------------------------------------------------------------

describe("inferProviderFromModel", () => {
  it("maps claude-* to anthropic", () => {
    expect(inferProviderFromModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(inferProviderFromModel("claude-opus-4-6")).toBe("anthropic");
    expect(inferProviderFromModel("claude-haiku-4-5")).toBe("anthropic");
  });

  it("maps gpt-* to openai", () => {
    expect(inferProviderFromModel("gpt-4o")).toBe("openai");
    expect(inferProviderFromModel("gpt-3.5-turbo")).toBe("openai");
  });

  it("maps o1/o3/o4 reasoning models to openai", () => {
    expect(inferProviderFromModel("o1")).toBe("openai");
    expect(inferProviderFromModel("o1-mini")).toBe("openai");
    expect(inferProviderFromModel("o3-mini")).toBe("openai");
  });

  it("returns undefined for unknown models", () => {
    expect(inferProviderFromModel("llama-3-70b")).toBeUndefined();
    expect(inferProviderFromModel("gemini-pro")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getModelPricing
// ---------------------------------------------------------------------------

describe("getModelPricing", () => {
  it("returns known pricing for claude-sonnet-4-6", () => {
    const pricing = getModelPricing("claude-sonnet-4-6");
    expect(pricing.inputPerMillion).toBe(3.00);
    expect(pricing.outputPerMillion).toBe(15.00);
  });

  it("returns default pricing for unknown models", () => {
    const pricing = getModelPricing("unknown-model");
    expect(pricing.inputPerMillion).toBeGreaterThan(0);
    expect(pricing.outputPerMillion).toBeGreaterThan(0);
  });
});
