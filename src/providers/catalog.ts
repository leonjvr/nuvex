// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13d: Provider Catalog
 *
 * Static registry of known LLM providers and their models.
 * This is a SUGGESTION layer, NOT a restriction — users can add any provider.
 *
 * Custom providers are stored in sidjua.yaml and merged at runtime.
 */

import { createLogger } from "../core/logger.js";
import { SidjuaError }  from "../core/error-codes.js";

const logger = createLogger("catalog");


export interface ProviderModelEntry {
  id:                   string;
  name:                 string;
  context_window?:      number;
  supports_tool_use?:   boolean;
  supports_vision?:     boolean;
  pricing?: {
    input_per_1m_tokens?:  number;
    output_per_1m_tokens?: number;
  };
  recommended_tier?: "t1" | "t2" | "t3";
}

export interface ProviderCatalogEntry {
  id:                string;
  name:              string;
  category:          "cloud" | "local" | "custom";
  api_format:        "anthropic" | "openai-compatible" | "cloudflare-ai";
  default_base_url:  string;
  requires_api_key:  boolean;
  requires_account_id?: boolean;
  models:            ProviderModelEntry[];
  pricing_tier:      "free" | "budget" | "standard" | "premium" | "unknown";
  docs_url?:         string;
  default_headers?:  Record<string, string>;
}

export interface CustomProviderInput {
  id:                  string;
  name:                string;
  base_url:            string;
  api_key_required:    boolean;
  models:              string[];
  supports_tool_use:   boolean | "auto";
  custom_headers?:     Record<string, string>;
}


const BUILTIN_CATALOG: ProviderCatalogEntry[] = [
  // ── Cloud providers ──────────────────────────────────────────────────────

  {
    id:               "anthropic",
    name:             "Anthropic",
    category:         "cloud",
    api_format:       "anthropic",
    default_base_url: "https://api.anthropic.com",
    requires_api_key: true,
    pricing_tier:     "premium",
    docs_url:         "https://docs.anthropic.com",
    models: [
      {
        id:                 "claude-opus-4-6",
        name:               "Claude Opus 4.6",
        context_window:     200_000,
        supports_tool_use:  true,
        supports_vision:    true,
        pricing:            { input_per_1m_tokens: 15, output_per_1m_tokens: 75 },
        recommended_tier:   "t1",
      },
      {
        id:                 "claude-sonnet-4-6",
        name:               "Claude Sonnet 4.6",
        context_window:     200_000,
        supports_tool_use:  true,
        supports_vision:    true,
        pricing:            { input_per_1m_tokens: 3, output_per_1m_tokens: 15 },
        recommended_tier:   "t2",
      },
      {
        id:                 "claude-haiku-4-5-20251001",
        name:               "Claude Haiku 4.5",
        context_window:     200_000,
        supports_tool_use:  true,
        supports_vision:    false,
        pricing:            { input_per_1m_tokens: 0.8, output_per_1m_tokens: 4 },
        recommended_tier:   "t3",
      },
    ],
  },

  {
    id:               "deepseek",
    name:             "DeepSeek",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.deepseek.com/v1",
    requires_api_key: true,
    pricing_tier:     "budget",
    docs_url:         "https://platform.deepseek.com/docs",
    models: [
      {
        id:                 "deepseek-reasoner",
        name:               "DeepSeek Reasoner (R1)",
        context_window:     128_000,
        supports_tool_use:  false,
        pricing:            { input_per_1m_tokens: 0.55, output_per_1m_tokens: 2.19 },
        recommended_tier:   "t1",
      },
      {
        id:                 "deepseek-chat",
        name:               "DeepSeek V3",
        context_window:     64_000,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 0.27, output_per_1m_tokens: 1.10 },
        recommended_tier:   "t2",
      },
    ],
  },

  {
    id:               "openai",
    name:             "OpenAI",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.openai.com/v1",
    requires_api_key: true,
    pricing_tier:     "premium",
    docs_url:         "https://platform.openai.com/docs",
    models: [
      {
        id:                 "o3",
        name:               "o3",
        context_window:     200_000,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 10, output_per_1m_tokens: 40 },
        recommended_tier:   "t1",
      },
      {
        id:                 "gpt-4o",
        name:               "GPT-4o",
        context_window:     128_000,
        supports_tool_use:  true,
        supports_vision:    true,
        pricing:            { input_per_1m_tokens: 2.5, output_per_1m_tokens: 10 },
        recommended_tier:   "t2",
      },
      {
        id:                 "gpt-4o-mini",
        name:               "GPT-4o Mini",
        context_window:     128_000,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 0.15, output_per_1m_tokens: 0.6 },
        recommended_tier:   "t3",
      },
    ],
  },

  {
    id:               "google-gemini",
    name:             "Google Gemini",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    requires_api_key: true,
    pricing_tier:     "standard",
    docs_url:         "https://ai.google.dev/gemini-api/docs",
    models: [
      {
        id:                 "gemini-2.5-pro",
        name:               "Gemini 2.5 Pro",
        context_window:     1_000_000,
        supports_tool_use:  true,
        supports_vision:    true,
        pricing:            { input_per_1m_tokens: 1.25, output_per_1m_tokens: 10 },
        recommended_tier:   "t1",
      },
      {
        id:                 "gemini-2.0-flash",
        name:               "Gemini 2.0 Flash",
        context_window:     1_000_000,
        supports_tool_use:  true,
        supports_vision:    true,
        pricing:            { input_per_1m_tokens: 0.10, output_per_1m_tokens: 0.40 },
        recommended_tier:   "t2",
      },
      {
        id:                 "gemini-2.0-flash-lite",
        name:               "Gemini 2.0 Flash Lite",
        context_window:     1_000_000,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 0.075, output_per_1m_tokens: 0.30 },
        recommended_tier:   "t3",
      },
    ],
  },

  {
    id:               "grok",
    name:             "Grok / xAI",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.x.ai/v1",
    requires_api_key: true,
    pricing_tier:     "standard",
    docs_url:         "https://docs.x.ai",
    models: [
      {
        id:                 "grok-3",
        name:               "Grok-3",
        context_window:     131_072,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 3, output_per_1m_tokens: 15 },
        recommended_tier:   "t1",
      },
      {
        id:                 "grok-3-mini",
        name:               "Grok-3 Mini",
        context_window:     131_072,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 0.3, output_per_1m_tokens: 0.5 },
        recommended_tier:   "t3",
      },
    ],
  },

  {
    id:               "kimi",
    name:             "Kimi / Moonshot",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.moonshot.ai/v1",
    requires_api_key: true,
    pricing_tier:     "budget",
    docs_url:         "https://platform.moonshot.ai/docs",
    models: [
      {
        id:               "kimi-k2",
        name:             "Kimi K2",
        context_window:   128_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0.6, output_per_1m_tokens: 2.5 },
        recommended_tier: "t1",
      },
      {
        id:               "moonshot-v1-32k",
        name:             "Moonshot v1 32k",
        context_window:   32_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0.24, output_per_1m_tokens: 0.24 },
        recommended_tier: "t3",
      },
    ],
  },

  {
    id:               "mistral",
    name:             "Mistral",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.mistral.ai/v1",
    requires_api_key: true,
    pricing_tier:     "budget",
    docs_url:         "https://docs.mistral.ai",
    models: [
      {
        id:                 "mistral-large-latest",
        name:               "Mistral Large",
        context_window:     131_072,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 2, output_per_1m_tokens: 6 },
        recommended_tier:   "t1",
      },
      {
        id:                 "mistral-small-latest",
        name:               "Mistral Small",
        context_window:     32_768,
        supports_tool_use:  true,
        pricing:            { input_per_1m_tokens: 0.1, output_per_1m_tokens: 0.3 },
        recommended_tier:   "t3",
      },
    ],
  },

  {
    id:               "cohere",
    name:             "Cohere",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.cohere.com/v2",
    requires_api_key: true,
    pricing_tier:     "standard",
    docs_url:         "https://docs.cohere.com",
    models: [
      {
        id:               "command-r-plus-08-2024",
        name:             "Command R+",
        context_window:   128_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 2.5, output_per_1m_tokens: 10 },
        recommended_tier: "t2",
      },
      {
        id:               "command-r-08-2024",
        name:             "Command R",
        context_window:   128_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0.15, output_per_1m_tokens: 0.6 },
        recommended_tier: "t3",
      },
    ],
  },

  {
    id:               "together-ai",
    name:             "Together AI",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.together.xyz/v1",
    requires_api_key: true,
    pricing_tier:     "budget",
    docs_url:         "https://docs.together.ai",
    models: [
      {
        id:               "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        name:             "Llama 3.3 70B Turbo",
        context_window:   131_072,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0.88, output_per_1m_tokens: 0.88 },
        recommended_tier: "t2",
      },
      {
        id:               "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
        name:             "Llama 3.2 11B Vision",
        context_window:   131_072,
        supports_tool_use: false,
        supports_vision:   true,
        pricing:          { input_per_1m_tokens: 0.18, output_per_1m_tokens: 0.18 },
        recommended_tier: "t3",
      },
    ],
  },

  {
    id:               "groq",
    name:             "Groq",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.groq.com/openai/v1",
    requires_api_key: true,
    pricing_tier:     "budget",
    docs_url:         "https://console.groq.com/docs",
    models: [
      {
        id:               "llama-3.3-70b-versatile",
        name:             "Llama 3.3 70B",
        context_window:   128_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0.59, output_per_1m_tokens: 0.79 },
        recommended_tier: "t2",
      },
      {
        id:               "llama-3.1-8b-instant",
        name:             "Llama 3.1 8B Instant",
        context_window:   128_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0.05, output_per_1m_tokens: 0.08 },
        recommended_tier: "t3",
      },
    ],
  },

  {
    id:               "fireworks-ai",
    name:             "Fireworks AI",
    category:         "cloud",
    api_format:       "openai-compatible",
    default_base_url: "https://api.fireworks.ai/inference/v1",
    requires_api_key: true,
    pricing_tier:     "budget",
    docs_url:         "https://docs.fireworks.ai",
    models: [
      {
        id:               "accounts/fireworks/models/llama-v3p3-70b-instruct",
        name:             "Llama 3.3 70B",
        context_window:   131_072,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0.9, output_per_1m_tokens: 0.9 },
        recommended_tier: "t2",
      },
      {
        id:               "accounts/fireworks/models/llama-v3p2-11b-vision-instruct",
        name:             "Llama 3.2 11B Vision",
        context_window:   131_072,
        supports_tool_use: false,
        supports_vision:   true,
        pricing:          { input_per_1m_tokens: 0.2, output_per_1m_tokens: 0.2 },
        recommended_tier: "t3",
      },
    ],
  },

  {
    id:                  "cloudflare-ai",
    name:                "Cloudflare Workers AI",
    category:            "cloud",
    api_format:          "cloudflare-ai",
    default_base_url:    "https://api.cloudflare.com/client/v4",
    requires_api_key:    true,
    requires_account_id: true,
    pricing_tier:        "free",
    docs_url:            "https://developers.cloudflare.com/workers-ai/",
    models: [
      {
        id:               "@cf/meta/llama-4-scout-17b-16e-instruct",
        name:             "Llama 4 Scout 17B",
        context_window:   128_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0, output_per_1m_tokens: 0 },
        recommended_tier: "t1",
      },
      {
        id:               "@cf/zai-org/glm-4.7-flash",
        name:             "GLM 4.7 Flash",
        context_window:   32_768,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0, output_per_1m_tokens: 0 },
        recommended_tier: "t3",
      },
      {
        id:               "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        name:             "Llama 3.3 70B Fast",
        context_window:   131_072,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0, output_per_1m_tokens: 0 },
        recommended_tier: "t2",
      },
    ],
  },

  {
    id:               "cloudflare",
    name:             "Cloudflare Workers AI (Embedded)",
    category:         "cloud",
    api_format:       "cloudflare-ai",
    default_base_url: "https://api.cloudflare.com/client/v4",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://developers.cloudflare.com/workers-ai/",
    models: [
      {
        id:               "@cf/meta/llama-4-scout-17b-16e-instruct",
        name:             "Llama 4 Scout 17B (Guide model)",
        context_window:   128_000,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0, output_per_1m_tokens: 0 },
        recommended_tier: "t1",
      },
      {
        id:               "@cf/qwen/qwen3-32b",
        name:             "Qwen3 32B (Guide fallback)",
        context_window:   32_768,
        supports_tool_use: true,
        pricing:          { input_per_1m_tokens: 0, output_per_1m_tokens: 0 },
        recommended_tier: "t2",
      },
    ],
  },

  // ── Local providers ───────────────────────────────────────────────────────

  {
    id:               "ollama",
    name:             "Ollama",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:11434/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://ollama.ai",
    models:           [], // user-defined; list via `ollama list`
  },

  {
    id:               "lm-studio",
    name:             "LM Studio",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:1234/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://lmstudio.ai",
    models:           [],
  },

  {
    id:               "studiolm",
    name:             "StudioLM",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:8080/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    models:           [],
  },

  {
    id:               "localai",
    name:             "LocalAI",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:8080/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://localai.io",
    models:           [],
  },

  {
    id:               "llama-cpp",
    name:             "llama.cpp server",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:8080/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://github.com/ggerganov/llama.cpp",
    models:           [],
  },

  {
    id:               "vllm",
    name:             "vLLM",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:8000/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://docs.vllm.ai",
    models:           [],
  },

  {
    id:               "tgi",
    name:             "TGI (HuggingFace)",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:8080/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://huggingface.co/docs/text-generation-inference",
    models:           [],
  },

  {
    id:               "jan",
    name:             "Jan",
    category:         "local",
    api_format:       "openai-compatible",
    default_base_url: "http://localhost:1337/v1",
    requires_api_key: false,
    pricing_tier:     "free",
    docs_url:         "https://jan.ai",
    models:           [],
  },
];

// Verify builtin counts at module load (compile-time guard)
const cloudCount = BUILTIN_CATALOG.filter((e) => e.category === "cloud").length;
const localCount = BUILTIN_CATALOG.filter((e) => e.category === "local").length;
if (cloudCount !== 13 || localCount !== 8) {
  // eslint-disable-next-line no-console
  throw new Error(`Catalog count mismatch: expected 13 cloud + 8 local, got ${cloudCount} + ${localCount}`);
}


export class ProviderCatalog {
  private readonly builtins:      ProviderCatalogEntry[];
  private readonly customEntries: ProviderCatalogEntry[] = [];

  constructor(customEntries: ProviderCatalogEntry[] = []) {
    this.builtins     = BUILTIN_CATALOG;
    this.customEntries.push(...customEntries);
  }

  /** All providers (builtins + custom). */
  getAll(): ProviderCatalogEntry[] {
    return [...this.builtins, ...this.customEntries];
  }

  /** Cloud providers (builtin only). */
  getCloud(): ProviderCatalogEntry[] {
    return this.builtins.filter((e) => e.category === "cloud");
  }

  /** Local providers (builtin only). */
  getLocal(): ProviderCatalogEntry[] {
    return this.builtins.filter((e) => e.category === "local");
  }

  /** User-added custom providers. */
  getCustom(): ProviderCatalogEntry[] {
    return [...this.customEntries];
  }

  /** Look up a provider by ID across all categories. */
  getById(id: string): ProviderCatalogEntry | undefined {
    return this.getAll().find((e) => e.id === id);
  }

  /** True if the ID exists in the builtin catalog. */
  isBuiltin(id: string): boolean {
    return this.builtins.some((e) => e.id === id);
  }

  /**
   * Add a user-defined custom provider.
   * Validates uniqueness before adding.
   */
  addCustom(input: CustomProviderInput): ProviderCatalogEntry {
    // Check for ID collision with builtins
    if (this.isBuiltin(input.id)) {
      throw SidjuaError.from(
        "PROV-009",
        `Provider ID "${input.id}" is already a builtin provider`,
      );
    }

    // Check for ID collision with existing custom entries
    if (this.customEntries.some((e) => e.id === input.id)) {
      throw SidjuaError.from(
        "PROV-009",
        `Custom provider "${input.id}" already exists`,
      );
    }

    const entry: ProviderCatalogEntry = {
      id:               input.id,
      name:             input.name,
      category:         "custom",
      api_format:       "openai-compatible",
      default_base_url: input.base_url,
      requires_api_key: input.api_key_required,
      pricing_tier:     "unknown",
      ...(input.custom_headers !== undefined && { default_headers: input.custom_headers }),
      models:           input.models.map((m) => ({
        id:                 m,
        name:               m,
        supports_tool_use:  input.supports_tool_use === true || input.supports_tool_use === "auto",
      })),
    };

    this.customEntries.push(entry);

    logger.info("custom_provider_added", `Custom provider added: ${input.id}`, {
      metadata: { id: input.id, base_url: input.base_url },
    });

    return entry;
  }

  /** Remove a custom provider by ID. */
  removeCustom(id: string): void {
    const idx = this.customEntries.findIndex((e) => e.id === id);
    if (idx === -1) {
      throw SidjuaError.from("PROV-009", `Custom provider "${id}" not found`);
    }
    this.customEntries.splice(idx, 1);
    logger.info("custom_provider_removed", `Custom provider removed: ${id}`, {
      metadata: { id },
    });
  }

  /** Get models for a provider (from catalog, not live query). */
  getModels(providerId: string): ProviderModelEntry[] {
    return this.getById(providerId)?.models ?? [];
  }
}


let defaultCatalog: ProviderCatalog | null = null;

/** Get the default shared ProviderCatalog instance. */
export function getDefaultCatalog(): ProviderCatalog {
  if (defaultCatalog === null) {
    defaultCatalog = new ProviderCatalog();
  }
  return defaultCatalog;
}

/** Reset the singleton (useful in tests). */
export function resetDefaultCatalog(): void {
  defaultCatalog = null;
}
