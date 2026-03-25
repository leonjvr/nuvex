// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13d: Custom Provider Manager
 *
 * Manages user-defined custom providers (any OpenAI-compatible endpoint).
 * Always uses OpenAICompatibleAdapter — no new adapter code needed.
 *
 * Lifecycle:
 *   add() → validate → store in catalog → register adapter in ProviderAdapterRegistry
 *   remove() → unregister adapter → remove from catalog
 */

import { createLogger }              from "../core/logger.js";
import { SidjuaError }               from "../core/error-codes.js";
import { ProviderCatalog }           from "./catalog.js";
import { OpenAICompatibleAdapter }   from "./adapters/openai-compatible-adapter.js";
import { ProviderAdapterRegistry }   from "./registry.js";
import type { ProviderCatalogEntry, CustomProviderInput } from "./catalog.js";

const logger = createLogger("catalog");


export class CustomProviderManager {
  constructor(
    private readonly catalog:   ProviderCatalog,
    private readonly registry?: ProviderAdapterRegistry,
  ) {}

  /**
   * Add a custom provider to the catalog and optionally register an adapter.
   */
  async add(input: CustomProviderInput): Promise<ProviderCatalogEntry> {
    // Validate input
    if (!input.id || !/^[a-z0-9_-]+$/.test(input.id)) {
      throw SidjuaError.from(
        "PROV-009",
        `Provider ID "${input.id}" is invalid. Use lowercase letters, digits, hyphens, underscores.`,
      );
    }

    if (!input.base_url || !input.base_url.startsWith("http")) {
      throw SidjuaError.from("PROV-009", `base_url must start with http:// or https://`);
    }

    if (!input.name || input.name.trim() === "") {
      throw SidjuaError.from("PROV-009", "name is required");
    }

    // Add to catalog (validates ID uniqueness)
    const entry = this.catalog.addCustom(input);

    // Register adapter in registry if provided
    if (this.registry !== undefined) {
      this.registerAdapter(input.id, input.base_url, input.custom_headers);
    }

    logger.info("custom_provider_registered", `Custom provider "${input.id}" added`, {
      metadata: { id: input.id, base_url: input.base_url, model_count: input.models.length },
    });

    return entry;
  }

  /**
   * Remove a custom provider from catalog and unregister adapter.
   */
  async remove(id: string): Promise<void> {
    this.catalog.removeCustom(id);

    if (this.registry !== undefined) {
      this.registry.unregister(id);
    }

    logger.info("custom_provider_removed", `Custom provider "${id}" removed`, {
      metadata: { id },
    });
  }

  /**
   * List all custom providers from the catalog.
   */
  list(): ProviderCatalogEntry[] {
    return this.catalog.getCustom();
  }

  /**
   * Register/re-register a custom provider's adapter in the ProviderAdapterRegistry.
   * Uses OpenAICompatibleAdapter unconditionally.
   */
  registerAdapter(
    id:              string,
    baseUrl:         string,
    customHeaders?:  Record<string, string>,
    apiKey?:         string,
    defaultModel?:   string,
  ): void {
    if (this.registry === undefined) {
      logger.warn("custom_provider_no_registry", "No registry provided — adapter not registered", {
        metadata: { id },
      });
      return;
    }

    const adapter = new OpenAICompatibleAdapter({
      apiKey:       apiKey ?? "",
      baseUrl,
      defaultModel: defaultModel ?? "",
      providerName: id,
      ...(customHeaders !== undefined && { customHeaders }),
    });

    this.registry.register(id, adapter);
  }
}
