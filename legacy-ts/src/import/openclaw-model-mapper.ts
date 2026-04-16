// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — OpenClaw Model Mapper
 *
 * Maps OpenClaw "provider/model-name" strings to SIDJUA provider + model IDs.
 */

import type { ModelMapping } from "./openclaw-types.js";


const EXACT_MAP: Record<string, ModelMapping> = {
  // Anthropic
  "anthropic/claude-sonnet-4-5":      { provider: "anthropic", model: "claude-sonnet-4-5" },
  "anthropic/claude-haiku-3-5":       { provider: "anthropic", model: "claude-haiku-3-5" },
  "anthropic/claude-opus-4-5":        { provider: "anthropic", model: "claude-opus-4-5" },
  "anthropic/claude-sonnet-4-6":      { provider: "anthropic", model: "claude-sonnet-4-6" },
  "anthropic/claude-haiku-4-5":       { provider: "anthropic", model: "claude-haiku-4-5" },
  "anthropic/claude-opus-4-6":        { provider: "anthropic", model: "claude-opus-4-6" },
  // OpenAI
  "openai/gpt-4.1":                   { provider: "openai", model: "gpt-4.1" },
  "openai/gpt-4.1-mini":              { provider: "openai", model: "gpt-4.1-mini" },
  "openai/gpt-4o":                    { provider: "openai", model: "gpt-4o" },
  "openai/gpt-4o-mini":               { provider: "openai", model: "gpt-4o-mini" },
  "openai/o3-mini":                   { provider: "openai", model: "o3-mini" },
  // Google
  "google/gemini-2.5-flash":          { provider: "google", model: "gemini-2.5-flash" },
  "google/gemini-2.5-pro":            { provider: "google", model: "gemini-2.5-pro" },
  "google/gemini-2.0-flash":          { provider: "google", model: "gemini-2.0-flash" },
  // Groq
  "groq/llama-3.3-70b-versatile":     { provider: "groq", model: "llama-3.3-70b" },
  "groq/llama-3.1-8b-instant":        { provider: "groq", model: "llama-3.1-8b" },
  "groq/mixtral-8x7b-32768":          { provider: "groq", model: "mixtral-8x7b" },
  // Mistral
  "mistral/mistral-large-latest":     { provider: "mistral", model: "mistral-large" },
  "mistral/mistral-small-latest":     { provider: "mistral", model: "mistral-small" },
  "mistral/open-mistral-nemo":        { provider: "mistral", model: "open-mistral-nemo" },
  // DeepSeek
  "deepseek/deepseek-chat":           { provider: "deepseek", model: "deepseek-v3" },
  "deepseek/deepseek-reasoner":       { provider: "deepseek", model: "deepseek-r1" },
  // xAI
  "xai/grok-3":                       { provider: "xai", model: "grok-3" },
  "xai/grok-3-mini":                  { provider: "xai", model: "grok-3-mini" },
  "xai/grok-beta":                    { provider: "xai", model: "grok-beta" },
};


const PREFIX_MAP: Record<string, string> = {
  anthropic:  "anthropic",
  openai:     "openai",
  google:     "google",
  groq:       "groq",
  mistral:    "mistral",
  deepseek:   "deepseek",
  xai:        "xai",
  openrouter: "openrouter",
  cohere:     "cohere",
  together:   "together",
  fireworks:  "fireworks",
};


/**
 * Map an OpenClaw model string (e.g. "anthropic/claude-sonnet-4-5") to a
 * SIDJUA { provider, model } pair.
 *
 * Resolution order:
 *   1. Exact match in EXACT_MAP
 *   2. Prefix-based split ("provider/model") with known provider
 *   3. openrouter/* pass-through
 *   4. Unknown → { provider: "custom", model: original }
 *
 * @throws if modelString is empty
 */
export function mapOpenClawModel(modelString: string): ModelMapping {
  const str = modelString.trim();
  if (!str) {
    throw new Error(
      "No model configured in OpenClaw. " +
      "Specify with: sidjua import openclaw --model anthropic/claude-sonnet-4-5",
    );
  }

  // 1. Exact match
  const exact = EXACT_MAP[str];
  if (exact) return exact;

  // 2. Split on first "/"
  const slashIdx = str.indexOf("/");
  if (slashIdx < 1) {
    // No slash — treat as a plain model name with unknown provider
    return { provider: "custom", model: str };
  }

  const prefix = str.slice(0, slashIdx).toLowerCase();
  const model  = str.slice(slashIdx + 1);

  // 3. openrouter pass-through
  if (prefix === "openrouter") {
    return { provider: "openrouter", model };
  }

  // 4. Known prefix
  const provider = PREFIX_MAP[prefix];
  if (provider) {
    return { provider, model };
  }

  // 5. Unknown provider — return model part only (strip unknown prefix)
  return { provider: "custom", model };
}

/**
 * Human-readable description of the mapped provider/model pair.
 */
export function describeMapped(mapping: ModelMapping): string {
  return `${mapping.provider}/${mapping.model}`;
}
