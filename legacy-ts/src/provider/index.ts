// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider Layer: Public API
 *
 * Re-exports everything needed to use the provider layer from other modules.
 * Import from "sidjua/provider" or "../../provider/index.js".
 */

// Core types (also available from src/types/provider.ts)
export type {
  BudgetCheckResult,
  EventBus,
  LLMProvider,
  Message,
  MessageRole,
  ModelId,
  ModelPricing,
  ProviderCallInput,
  ProviderCallRequest,
  ProviderCallResponse,
  ProviderConfig,
  ProviderName,
  RegistryConfig,
  RetryConfig,
  TokenUsage,
} from "../types/provider.js";

export {
  BudgetExceededError,
  NoOpEventBus,
  ProviderError,
} from "../types/provider.js";

// Token counter
export {
  calculateCost,
  estimateCallCost,
  estimateMessagesTokens,
  estimateTokenCount,
  getModelPricing,
  inferProviderFromModel,
} from "./token-counter.js";

// Cost tracker
export { CostTracker } from "./cost-tracker.js";

// Audit logger
export { ProviderAuditLogger } from "./audit-logger.js";

// Retry handler
export {
  DEFAULT_RETRY_CONFIG,
  RetryHandler,
  TEST_RETRY_CONFIG,
} from "./retry-handler.js";
export type { RetryContext } from "./retry-handler.js";

// Registry
export { ProviderRegistry } from "./registry.js";

// Adapters
export { AnthropicProvider, createAnthropicProvider } from "./adapters/anthropic.js";
export type { AnthropicProviderOptions } from "./adapters/anthropic.js";

export { createOpenAIProvider, OpenAIProvider } from "./adapters/openai.js";
export type { OpenAIProviderOptions } from "./adapters/openai.js";

export { makeMockRequest, MockProvider } from "./adapters/mock.js";
export type { MockResponseSpec } from "./adapters/mock.js";
