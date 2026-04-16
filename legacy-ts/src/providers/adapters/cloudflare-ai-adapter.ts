// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13a: Cloudflare Workers AI Raw-HTTP Adapter
 *
 * Uses the OpenAI-compatible endpoint for Cloudflare Workers AI to minimise
 * adapter complexity (tool-use format matches OpenAI).
 *
 * Endpoint:
 *   POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions
 *
 * Free tier: 10 000 Neurons/day (approximately 10 000 short requests).
 */

import { createLogger }              from "../../core/logger.js";
import { SidjuaError }               from "../../core/error-codes.js";
import { OpenAICompatibleAdapter }   from "./openai-compatible-adapter.js";
import type {
  LLMMessage,
  LLMRequest,
  LLMResponse,
  ModelDefinition,
  ProviderAdapter,
  ToolDefinition,
  ToolLLMResponse,
} from "../types.js";

const logger = createLogger("providers");


export interface CloudflareAIAdapterConfig {
  accountId:    string;
  apiKey:       string;           // Cloudflare API token
  defaultModel: string;           // e.g. "@cf/zai-org/glm-4.7-flash"
  timeout_ms?:  number;           // default: 60 000
}


/**
 * Thin wrapper over OpenAICompatibleAdapter that points at the Cloudflare
 * Workers AI OpenAI-compatible endpoint.
 */
export class CloudflareAIAdapter implements ProviderAdapter {
  readonly providerName = "cloudflare-ai";
  readonly defaultModel: string;

  private readonly inner: OpenAICompatibleAdapter;

  constructor(config: CloudflareAIAdapterConfig) {
    this.defaultModel = config.defaultModel;

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`;

    this.inner = new OpenAICompatibleAdapter({
      apiKey:       config.apiKey,
      baseUrl,
      defaultModel: config.defaultModel,
      providerName: "cloudflare-ai",
      timeout_ms:   config.timeout_ms ?? 60_000,
    });
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    return this.inner.chat(request);
  }

  async chatWithTools(request: LLMRequest, tools: ToolDefinition[]): Promise<ToolLLMResponse> {
    return this.inner.chatWithTools(request, tools);
  }

  estimateTokens(messages: LLMMessage[]): number {
    return this.inner.estimateTokens(messages);
  }

  getModels(): ModelDefinition[] {
    return [
      {
        id:            "@cf/zai-org/glm-4.7-flash",
        displayName:   "GLM-4.7 Flash",
        contextWindow: 128_000,
        pricing:       { inputPerMillion: 0, outputPerMillion: 0 }, // free tier
      },
      {
        id:            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        displayName:   "Llama 3.3 70B (fast)",
        contextWindow: 128_000,
        pricing:       { inputPerMillion: 0, outputPerMillion: 0 }, // free tier
      },
      {
        id:            "@cf/google/gemma-3-12b-it",
        displayName:   "Gemma 3 12B",
        contextWindow: 8_192,
        pricing:       { inputPerMillion: 0, outputPerMillion: 0 }, // free tier
      },
    ];
  }
}
