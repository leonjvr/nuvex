// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider Layer: Mock Adapter
 *
 * MockProvider implements LLMProvider for testing. It does NOT make network calls.
 *
 * Usage:
 *   const mock = new MockProvider();
 *   mock.queueResponse({ content: "Hello!", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
 *   const response = await mock.call(request);
 *
 * If no response is queued, returns a default response with predictable values.
 * Call log is accessible via getCallLog() for assertions.
 */

import { randomUUID } from "node:crypto";
import type {
  LLMProvider,
  Message,
  ProviderCallRequest,
  ProviderCallResponse,
  ProviderName,
  TokenUsage,
} from "../../types/provider.js";
import { calculateCost, estimateMessagesTokens } from "../token-counter.js";


const DEFAULT_CONTENT = "Mock response from MockProvider.";
const DEFAULT_MODEL   = "mock-model-v1";

function makeDefaultUsage(inputTokens: number): TokenUsage {
  const outputTokens = Math.max(1, Math.ceil(inputTokens * 0.3));
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}


export interface MockResponseSpec {
  content?: string;
  usage?: Partial<TokenUsage>;
  latencyMs?: number;
  finishReason?: string;
  /** If set, mock.call() throws this error instead of returning a response. */
  error?: Error;
}


/**
 * Mock LLM provider for unit and integration testing.
 *
 * @example
 * const mock = new MockProvider("openai");
 * mock.queueResponse({ content: "42", usage: { inputTokens: 100, outputTokens: 1, totalTokens: 101 } });
 * const resp = await mock.call(request);
 * expect(resp.content).toBe("42");
 * expect(mock.getCallLog()).toHaveLength(1);
 */
export class MockProvider implements LLMProvider {
  readonly name: ProviderName;

  private readonly responseQueue: MockResponseSpec[] = [];
  private readonly callLog: ProviderCallRequest[] = [];
  private _available = true;

  constructor(name: ProviderName = "anthropic") {
    this.name = name;
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a response to be returned by the next call().
   * Responses are consumed FIFO. If the queue is empty, a default response is used.
   */
  queueResponse(spec: MockResponseSpec): void {
    this.responseQueue.push(spec);
  }

  /** Return a copy of all calls received, in order. */
  getCallLog(): ProviderCallRequest[] {
    return [...this.callLog];
  }

  /** Clear the call log (useful in beforeEach). */
  clearCallLog(): void {
    this.callLog.length = 0;
  }

  /** Clear any queued responses. */
  clearQueue(): void {
    this.responseQueue.length = 0;
  }

  /** Control the result of isAvailable(). */
  setAvailable(available: boolean): void {
    this._available = available;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider implementation
  // ---------------------------------------------------------------------------

  async call(request: ProviderCallRequest): Promise<ProviderCallResponse> {
    this.callLog.push(request);

    const spec = this.responseQueue.shift();

    if (spec?.error !== undefined) {
      throw spec.error;
    }

    // Simulate minimal latency so latencyMs > 0 in tests
    await delay(spec?.latencyMs ?? 1);

    const estimatedInput = estimateMessagesTokens(request.messages, request.systemPrompt);
    const defaultUsage   = makeDefaultUsage(estimatedInput);

    const inputTokens  = spec?.usage?.inputTokens  ?? defaultUsage.inputTokens;
    const outputTokens = spec?.usage?.outputTokens ?? defaultUsage.outputTokens;
    const totalTokens  = spec?.usage?.totalTokens  ?? inputTokens + outputTokens;

    const usage: TokenUsage = { inputTokens, outputTokens, totalTokens };
    const model  = request.model.length > 0 ? request.model : DEFAULT_MODEL;
    const cost   = calculateCost(usage, model);

    return {
      callId:       request.callId,
      provider:     this.name,
      model,
      content:      spec?.content ?? DEFAULT_CONTENT,
      usage,
      costUsd:      cost,
      latencyMs:    spec?.latencyMs ?? 1,
      finishReason: spec?.finishReason ?? "end_turn",
    };
  }

  estimateTokens(messages: Message[], systemPrompt?: string): number {
    return estimateMessagesTokens(messages, systemPrompt);
  }

  async isAvailable(): Promise<boolean> {
    return this._available;
  }
}


function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a minimal valid ProviderCallRequest for testing.
 */
export function makeMockRequest(
  overrides: Partial<ProviderCallRequest> = {},
): ProviderCallRequest {
  return {
    callId:       randomUUID(),
    agentId:      "test-agent",
    divisionCode: "engineering",
    provider:     "anthropic",
    model:        "claude-sonnet-4-6",
    messages:     [{ role: "user", content: "Hello!" }],
    ...overrides,
  };
}
