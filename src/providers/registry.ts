// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13a: Provider Adapter Registry
 *
 * Manages a set of ProviderAdapter instances. Separate from the Phase 6
 * ProviderRegistry (which uses the SDK-based LLMProvider interface and
 * budget/audit infrastructure).
 *
 * This registry is used by Phase 13 agent execution to:
 *   - Select a provider for chat / tool-use calls
 *   - Fall back to a secondary provider on error
 *   - Expose adapter by name for hot-swap
 *
 * Key registration is driven by available API keys: adapters are only
 * registered for providers that have a key configured.
 */

import { createLogger }     from "../core/logger.js";
import { SidjuaError }      from "../core/error-codes.js";
import { ProviderKeyManager } from "./key-manager.js";
import { AnthropicAdapter }  from "./adapters/anthropic-adapter.js";
import { OpenAICompatibleAdapter } from "./adapters/openai-compatible-adapter.js";
import { CloudflareAIAdapter }    from "./adapters/cloudflare-ai-adapter.js";
import type { ProviderAdapter }   from "./types.js";

const logger = createLogger("providers");


export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  /** Register a named adapter. */
  register(name: string, adapter: ProviderAdapter): void {
    this.adapters.set(name, adapter);
    logger.info("adapter_registered", `Provider adapter registered: ${name}`, {
      metadata: { name, providerName: adapter.providerName },
    });
  }

  /** Get a registered adapter by name. Throws PROV-001 if not found. */
  get(name: string): ProviderAdapter {
    const adapter = this.adapters.get(name);
    if (adapter === undefined) {
      throw SidjuaError.from("PROV-001", `No adapter registered for provider "${name}"`);
    }
    return adapter;
  }

  /** Unregister a named adapter (e.g. when a custom provider is removed). */
  unregister(name: string): void {
    this.adapters.delete(name);
    logger.info("adapter_unregistered", `Provider adapter unregistered: ${name}`, {
      metadata: { name },
    });
  }

  /** List all registered adapter names. */
  list(): string[] {
    return [...this.adapters.keys()];
  }

  /** True if at least one adapter is registered. */
  hasAny(): boolean {
    return this.adapters.size > 0;
  }
}


/**
 * Build a ProviderAdapterRegistry by checking available API keys.
 * Only registers providers for which a key is configured.
 *
 * Priority order (for default selection):
 *   1. Anthropic (highest quality)
 *   2. DeepSeek  (cost-effective)
 *   3. Cloudflare Workers AI (free tier)
 *   4. OpenAI, Grok, Kimi (V1.1)
 */
export async function createRegistryFromEnvironment(
  keyManager: ProviderKeyManager = new ProviderKeyManager(),
): Promise<{ registry: ProviderAdapterRegistry; defaultProvider: string | null }> {
  const registry = new ProviderAdapterRegistry();

  // Anthropic
  if (await keyManager.hasKey("anthropic")) {
    const key = await keyManager.getKey("anthropic");
    registry.register("anthropic", new AnthropicAdapter({
      apiKey:       key,
      defaultModel: "claude-sonnet-4-6",
    }));
  }

  // OpenAI
  if (await keyManager.hasKey("openai")) {
    const key = await keyManager.getKey("openai");
    registry.register("openai", new OpenAICompatibleAdapter({
      apiKey:       key,
      baseUrl:      "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
      providerName: "openai",
    }));
  }

  // DeepSeek
  if (await keyManager.hasKey("deepseek")) {
    const key = await keyManager.getKey("deepseek");
    registry.register("deepseek", new OpenAICompatibleAdapter({
      apiKey:       key,
      baseUrl:      "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      providerName: "deepseek",
    }));
  }

  // Cloudflare Workers AI
  if (await keyManager.hasKey("cloudflare-ai")) {
    const key       = await keyManager.getKey("cloudflare-ai");
    const accountId = await keyManager.getCloudflareAccountId();
    if (accountId) {
      registry.register("cloudflare-ai", new CloudflareAIAdapter({
        accountId,
        apiKey:       key,
        defaultModel: "@cf/zai-org/glm-4.7-flash",
      }));
    }
  }

  // Grok + Kimi: prepared but NOT registered by default in V1
  // (uncomment when V1.1 ships)

  // Determine default provider
  const priority = ["anthropic", "deepseek", "cloudflare-ai", "openai"];
  const defaultProvider = priority.find((p) => registry.list().includes(p)) ?? null;

  logger.info("registry_built", `Provider adapter registry built`, {
    metadata: { providers: registry.list(), defaultProvider },
  });

  return { registry, defaultProvider };
}
