// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider Layer: Anthropic Adapter
 *
 * Wraps the @anthropic-ai/sdk to implement LLMProvider.
 *
 * Key behaviours:
 *   - Non-streaming: messages.create() with stream:false (default).
 *     Streaming is intentionally not exposed — the full response is buffered.
 *     All call data is logged for audit.
 *   - Message format translation: sidjua Message[] → Anthropic MessageParam[].
 *     System role messages are either used as the system parameter or merged
 *     with a provided systemPrompt.
 *   - Error mapping: Anthropic.APIError → ProviderError with isRetryable set
 *     based on HTTP status (429, 529, 5xx = retryable; 4xx = not retryable).
 *   - API key: injected via constructor (retrieved from Secrets layer by caller).
 *
 * Factory:
 *   createAnthropicProvider(apiKey, options?) creates a ready-to-use AnthropicProvider.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, Message, ProviderCallRequest, ProviderCallResponse } from "../../types/provider.js";
import { ProviderError } from "../../types/provider.js";
import { calculateCost, estimateMessagesTokens } from "../token-counter.js";
import { isNetworkError } from "../utils/network-errors.js";


/** Options for AnthropicProvider constructor. */
export interface AnthropicProviderOptions {
  /** Default max_tokens when none is specified on the call request. */
  defaultMaxTokens?: number;
  /** Request timeout in milliseconds (passed to SDK). */
  timeoutMs?: number;
}

/**
 * Anthropic Claude adapter implementing the SIDJUA LLMProvider interface.
 *
 * @example
 * const provider = createAnthropicProvider(apiKey);
 * const response = await provider.call(request);
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;

  private readonly client: Anthropic;
  private readonly defaultMaxTokens: number;

  constructor(apiKey: string, options: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      apiKey,
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider implementation
  // ---------------------------------------------------------------------------

  async call(request: ProviderCallRequest): Promise<ProviderCallResponse> {
    const start = Date.now();

    // Build the message list, excluding system messages (handled separately)
    const messages: Anthropic.MessageParam[] = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role:    m.role as "user" | "assistant",
        content: m.content,
      }));

    // Resolve system prompt: explicit systemPrompt takes priority over
    // inline system-role messages
    const systemContent =
      request.systemPrompt ??
      request.messages.find((m) => m.role === "system")?.content;

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model:      request.model,
      messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      ...(systemContent !== undefined ? { system: systemContent } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };

    let anthropicResp: Anthropic.Message;
    try {
      anthropicResp = await this.client.messages.create(params);
    } catch (err) {
      throw mapAnthropicError(err);
    }

    // Extract text content (ignore non-text blocks like tool_use in V1)
    const content = anthropicResp.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const usage = {
      inputTokens:  anthropicResp.usage.input_tokens,
      outputTokens: anthropicResp.usage.output_tokens,
      totalTokens:  anthropicResp.usage.input_tokens + anthropicResp.usage.output_tokens,
    };

    const base = {
      callId:    request.callId,
      provider:  "anthropic" as const,
      model:     request.model,
      content,
      usage,
      costUsd:   calculateCost(usage, request.model),
      latencyMs: Date.now() - start,
    };

    if (anthropicResp.stop_reason != null) {
      return { ...base, finishReason: anthropicResp.stop_reason };
    }
    return base;
  }

  estimateTokens(messages: Message[], systemPrompt?: string): number {
    return estimateMessagesTokens(messages, systemPrompt);
  }

  async isAvailable(): Promise<boolean> {
    // V1: available if the client was constructed (has an API key)
    // Does not make a network call to avoid latency/cost on health checks
    return true;
  }
}


/**
 * Create a fully-configured AnthropicProvider.
 * The API key should come from the Secrets layer — never hardcoded.
 */
export function createAnthropicProvider(
  apiKey: string,
  options?: AnthropicProviderOptions,
): AnthropicProvider {
  return new AnthropicProvider(apiKey, options);
}


/**
 * Map an Anthropic SDK error to a SIDJUA ProviderError.
 *
 * Retryable (isRetryable=true):
 *   - 429 Too Many Requests (rate limit)
 *   - 529 Overloaded
 *   - 500+ Server errors
 *
 * Non-retryable (isRetryable=false):
 *   - 400 Bad Request (invalid parameters)
 *   - 401 Unauthorised (invalid API key)
 *   - 403 Forbidden
 *   - 404 Not Found (invalid model)
 *   - Any other 4xx
 */
function mapAnthropicError(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const status      = err.status ?? 0;
    const isRetryable = status === 429 || status === 529 || status >= 500;
    return new ProviderError(
      "anthropic",
      String(status),
      err.message,
      isRetryable,
      err,
    );
  }

  // Network errors, timeouts, etc.
  if (err instanceof Error) {
    const isRetryable = isNetworkError(err);
    return new ProviderError("anthropic", "NETWORK_ERROR", err.message, isRetryable, err);
  }

  return new ProviderError("anthropic", "UNKNOWN", String(err), false, err);
}

