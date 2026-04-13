// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider Layer: OpenAI Adapter
 *
 * Wraps the `openai` SDK to implement LLMProvider.
 *
 * Key behaviours:
 *   - Non-streaming: chat.completions.create() with stream:false.
 *     Streaming is intentionally not exposed — the full response is buffered.
 *   - Message format translation: sidjua Message[] → OpenAI ChatCompletionMessageParam[].
 *     System role messages are included natively (OpenAI supports role:"system").
 *     systemPrompt is prepended as a role:"system" message when provided.
 *   - Error mapping: OpenAI.APIError → ProviderError with isRetryable based on
 *     HTTP status (429, 5xx = retryable; 4xx = not retryable).
 *   - API key: injected via constructor (retrieved from Secrets layer by caller).
 *
 * Factory:
 *   createOpenAIProvider(apiKey, options?) creates a ready-to-use OpenAIProvider.
 */

import OpenAI from "openai";
import type { LLMProvider, Message, ProviderCallRequest, ProviderCallResponse } from "../../types/provider.js";
import { ProviderError } from "../../types/provider.js";
import { calculateCost, estimateMessagesTokens } from "../token-counter.js";
import { isNetworkError } from "../utils/network-errors.js";


/** Options for OpenAIProvider constructor. */
export interface OpenAIProviderOptions {
  /** Default max_tokens when none is specified on the call request. */
  defaultMaxTokens?: number;
  /** Request timeout in milliseconds (passed to SDK). */
  timeoutMs?: number;
  /** Override the base URL (for compatible providers, e.g. Azure OpenAI). */
  baseURL?: string;
}

/**
 * OpenAI GPT adapter implementing the SIDJUA LLMProvider interface.
 *
 * @example
 * const provider = createOpenAIProvider(apiKey);
 * const response = await provider.call(request);
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;

  private readonly client: OpenAI;
  private readonly defaultMaxTokens: number;

  constructor(apiKey: string, options: OpenAIProviderOptions = {}) {
    this.client = new OpenAI({
      apiKey,
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
      ...(options.baseURL !== undefined   ? { baseURL: options.baseURL }   : {}),
    });
    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider implementation
  // ---------------------------------------------------------------------------

  async call(request: ProviderCallRequest): Promise<ProviderCallResponse> {
    const start = Date.now();

    // Build OpenAI message array.
    // systemPrompt (if provided) is prepended as a system message.
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (request.systemPrompt !== undefined && request.systemPrompt.length > 0) {
      messages.push({ role: "system", content: request.systemPrompt });
    }

    for (const msg of request.messages) {
      // Skip inline system messages when an explicit systemPrompt is provided
      // to avoid duplicates
      if (msg.role === "system" && request.systemPrompt !== undefined) {
        continue;
      }
      messages.push({ role: msg.role, content: msg.content });
    }

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model:      request.model,
      messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };

    let openaiResp: OpenAI.Chat.ChatCompletion;
    try {
      openaiResp = await this.client.chat.completions.create(params);
    } catch (err) {
      throw mapOpenAIError(err);
    }

    const choice  = openaiResp.choices[0];
    const content = choice?.message?.content ?? "";

    const usageData = openaiResp.usage;
    const usage = {
      inputTokens:  usageData?.prompt_tokens     ?? 0,
      outputTokens: usageData?.completion_tokens ?? 0,
      totalTokens:  usageData?.total_tokens       ?? 0,
    };

    const base = {
      callId:    request.callId,
      provider:  "openai" as const,
      model:     request.model,
      content,
      usage,
      costUsd:   calculateCost(usage, request.model),
      latencyMs: Date.now() - start,
    };

    const finishReason = choice?.finish_reason;
    if (finishReason != null) {
      return { ...base, finishReason };
    }
    return base;
  }

  estimateTokens(messages: Message[], systemPrompt?: string): number {
    return estimateMessagesTokens(messages, systemPrompt);
  }

  async isAvailable(): Promise<boolean> {
    // V1: available if the client was constructed (has an API key)
    return true;
  }
}


/**
 * Create a fully-configured OpenAIProvider.
 * The API key should come from the Secrets layer — never hardcoded.
 */
export function createOpenAIProvider(
  apiKey: string,
  options?: OpenAIProviderOptions,
): OpenAIProvider {
  return new OpenAIProvider(apiKey, options);
}


/**
 * Map an OpenAI SDK error to a SIDJUA ProviderError.
 *
 * Retryable (isRetryable=true):
 *   - 429 Too Many Requests (rate limit)
 *   - 500+ Server errors
 *
 * Non-retryable (isRetryable=false):
 *   - 400 Bad Request
 *   - 401 Unauthorised
 *   - 403 Forbidden
 *   - 404 Not Found (invalid model)
 *   - Any other 4xx
 */
function mapOpenAIError(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIError) {
    const status      = err.status ?? 0;
    const isRetryable = status === 429 || status >= 500;
    return new ProviderError(
      "openai",
      String(status),
      err.message,
      isRetryable,
      err,
    );
  }

  if (err instanceof Error) {
    const isRetryable = isNetworkError(err);
    return new ProviderError("openai", "NETWORK_ERROR", err.message, isRetryable, err);
  }

  return new ProviderError("openai", "UNKNOWN", String(err), false, err);
}

