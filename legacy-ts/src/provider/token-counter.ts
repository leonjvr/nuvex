// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider Layer: Token Counter
 *
 * Provides:
 *   - Heuristic token estimation for pre-call budget checks
 *     (actual counts come from the provider response)
 *   - Model-specific pricing table for USD cost calculation
 *   - calculateCost(usage, model) — converts TokenUsage to USD
 *
 * Token estimation algorithm:
 *   ~1 token per 4 characters of English text (widely-cited approximation).
 *   Overhead per message: +4 tokens for role/format markers.
 *   This is deliberately conservative (may overestimate) to avoid budget surprises.
 */

import type { Message, ModelId, ModelPricing, ProviderName, TokenUsage } from "../types/provider.js";


/**
 * Token counter using tiktoken (cl100k_base encoding) when available.
 * Falls back to chars/3 heuristic if tiktoken fails to load or throws.
 *
 * cl100k_base is used by Claude and GPT-4 family — good accuracy for both.
 * The chars/4 heuristic previously underestimated token counts for code,
 * JSON, and non-English text; chars/3 is a safer conservative estimate.
 */
type TiktokenEncoder = { encode: (text: string) => Uint32Array; free: () => void };
let _tiktokenGetEncoding: ((name: string) => TiktokenEncoder) | null = null;
// Promise-based singleton: concurrent callers all await the same load promise,
// ensuring tiktoken is loaded exactly once even under concurrent startup.
let _tiktokenReady: Promise<void> | null = null;

function _doLoadTiktoken(): Promise<void> {
  if (_tiktokenReady !== null) return _tiktokenReady;
  _tiktokenReady = (async () => {
    try {
      const mod = await import("tiktoken");
      _tiktokenGetEncoding = mod.get_encoding as (name: string) => TiktokenEncoder;
    } catch (e: unknown) { void e; /* cleanup-ignore: tiktoken not available — use heuristic fallback, cannot use logger before module is ready */
      _tiktokenGetEncoding = null;
    }
  })();
  return _tiktokenReady;
}

// Kick off the async load at module initialisation (best-effort, no await)
void _doLoadTiktoken();

/**
 * Count tokens in a string using tiktoken when loaded, or chars/3 as fallback.
 * Sync — uses pre-loaded encoder if ready; otherwise uses the heuristic.
 */
function countTokens(text: string): number {
  if (_tiktokenGetEncoding !== null) {
    try {
      const enc = _tiktokenGetEncoding("cl100k_base");
      const len = enc.encode(text).length;
      enc.free();
      return len;
    } catch (e: unknown) { void e; /* cleanup-ignore: encoding error — fall through to heuristic (sync function, cannot use logger) */ }
  }
  // chars/3 is more accurate than chars/4 for mixed content
  return Math.ceil(text.length / 3);
}


/**
 * Known model pricing. Falls back to DEFAULT_PRICING for unrecognised models.
 * Values are USD per 1,000,000 tokens.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude (claude-sonnet-4-6 family)
  "claude-opus-4-6":   { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  "claude-sonnet-4-6": { inputPerMillion:  3.00, outputPerMillion: 15.00 },
  "claude-haiku-4-5":  { inputPerMillion:  0.80, outputPerMillion:  4.00 },

  // OpenAI
  "gpt-4o":            { inputPerMillion:  2.50, outputPerMillion: 10.00 },
  "gpt-4o-mini":       { inputPerMillion:  0.15, outputPerMillion:  0.60 },
  "gpt-4-turbo":       { inputPerMillion: 10.00, outputPerMillion: 30.00 },
  "gpt-3.5-turbo":     { inputPerMillion:  0.50, outputPerMillion:  1.50 },
  "o1":                { inputPerMillion: 15.00, outputPerMillion: 60.00 },
  "o1-mini":           { inputPerMillion:  3.00, outputPerMillion: 12.00 },
};

/** Fallback pricing for models not in the table. Conservative estimate. */
const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 5.00, outputPerMillion: 15.00 };


/**
 * Retrieve the pricing entry for a model.
 * Returns DEFAULT_PRICING if the model is not in the table.
 */
export function getModelPricing(model: ModelId): ModelPricing {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

/**
 * Estimate the token count for a single text string.
 *
 * Uses tiktoken (cl100k_base) when loaded, falls back to chars/3 heuristic.
 * The former chars/4 heuristic underestimated token counts for code and
 * non-English text.
 */
export function estimateTokenCount(text: string): number {
  return countTokens(text);
}

/**
 * Estimate total token count for a set of messages + optional system prompt.
 *
 * Accounts for:
 *   - System prompt tokens (if provided)
 *   - Per-message content tokens
 *   - Per-message overhead (role marker + formatting): 4 tokens each
 *   - Conversation start/end overhead: 3 tokens
 */
export function estimateMessagesTokens(messages: Message[], systemPrompt?: string): number {
  let total = 3; // conversation overhead

  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    total += estimateTokenCount(systemPrompt) + 4;
  }

  for (const msg of messages) {
    if (msg.role === "system" && systemPrompt !== undefined) {
      // Skip system messages when a dedicated systemPrompt is provided
      // (to avoid double-counting)
      continue;
    }
    total += estimateTokenCount(msg.content) + 4;
  }

  return total;
}

/**
 * Calculate the USD cost of a completed call given actual token usage.
 *
 * @param usage - Actual token counts from the provider response.
 * @param model - Model identifier used for the call.
 */
export function calculateCost(usage: TokenUsage, model: ModelId): number {
  const pricing = getModelPricing(model);
  const inputCost  = (usage.inputTokens  / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Estimate the USD cost of a call before it is made, based on heuristic token counts.
 * Used for pre-call budget checks — actual cost is calculated from the response.
 *
 * @param messages - Messages to be sent.
 * @param model - Model to be used.
 * @param systemPrompt - Optional system prompt.
 * @param expectedOutputTokens - Expected output size (default: 30% of estimated input).
 */
export function estimateCallCost(
  messages: Message[],
  model: ModelId,
  systemPrompt?: string,
  expectedOutputTokens?: number,
): { estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCostUsd: number } {
  const estimatedInputTokens = estimateMessagesTokens(messages, systemPrompt);
  const estimatedOutputTokens = expectedOutputTokens ?? Math.ceil(estimatedInputTokens * 0.3);

  const usage: TokenUsage = {
    inputTokens:  estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
    totalTokens:  estimatedInputTokens + estimatedOutputTokens,
  };

  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: calculateCost(usage, model),
  };
}

/**
 * Return the provider name that owns a given model (for validation/display).
 * Returns undefined for unknown models.
 */
export function inferProviderFromModel(model: ModelId): ProviderName | undefined {
  if (model.startsWith("claude-")) return "anthropic";
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    return "openai";
  }
  return undefined;
}
