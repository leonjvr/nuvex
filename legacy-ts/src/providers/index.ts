// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13a: Provider Adapters — Public API
 *
 * Raw-HTTP provider adapters for Anthropic, OpenAI-compatible providers
 * (OpenAI, DeepSeek, Grok, Kimi), and Cloudflare Workers AI.
 *
 * Separate from the Phase 6 LLMProvider / ProviderRegistry stack.
 * Phase 13 agent execution imports from this barrel.
 */

// Types
export type {
  AgentDecision,
  AnthropicTool,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  ModelDefinition,
  OpenAITool,
  ProviderAdapter,
  SubTaskDefinition,
  ToolCall,
  ToolDefinition,
  ToolLLMResponse,
  ToolParameterSchema,
  TokenUsage,
  ValidationResult,
} from "./types.js";

// Adapters
export { AnthropicAdapter }         from "./adapters/anthropic-adapter.js";
export type { AnthropicAdapterConfig } from "./adapters/anthropic-adapter.js";

export { OpenAICompatibleAdapter }  from "./adapters/openai-compatible-adapter.js";
export type { OpenAICompatibleAdapterConfig } from "./adapters/openai-compatible-adapter.js";

export { CloudflareAIAdapter }      from "./adapters/cloudflare-ai-adapter.js";
export type { CloudflareAIAdapterConfig } from "./adapters/cloudflare-ai-adapter.js";

// Tool response parser + constants
export {
  AGENT_DECISION_TOOLS,
  ANTHROPIC_TOOLS,
  OPENAI_TOOLS,
  ToolResponseParser,
} from "./tool-response-parser.js";

// Key manager
export { ProviderKeyManager } from "./key-manager.js";

// Registry
export {
  ProviderAdapterRegistry,
  createRegistryFromEnvironment,
} from "./registry.js";
