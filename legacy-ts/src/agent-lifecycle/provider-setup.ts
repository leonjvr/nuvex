// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: ProviderSetup
 *
 * Provider registration from providers.yaml.
 * API key validation via SecretsManager (Phase 4).
 * Health checks by probing the provider API.
 */

import { readFile, access } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Database } from "../utils/db.js";
import type { ProviderLifecycleConfig, ProviderModelConfig, ProvidersYaml } from "./types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("provider-setup");


interface ProviderConfigRow {
  id: string;
  type: string;
  config_yaml: string;
  api_key_ref: string;
  last_health_check: string | null;
  health_status: string;
  created_at: string;
}


export interface ProviderHealthResult {
  provider: string;
  status: "healthy" | "degraded" | "unreachable" | "unauthorized";
  latency_ms?: number;
  models_available?: number;
  error?: string;
  checked_at: string;
}


export class ProviderSetup {
  constructor(
    private readonly db: Database,
    private readonly secretsGet?: (key: string) => string | undefined,
  ) {}

  // ---------------------------------------------------------------------------
  // Load providers.yaml
  // ---------------------------------------------------------------------------

  /**
   * Parse and load a providers.yaml file into the database.
   * Existing provider rows are updated (upserted).
   */
  async loadFromFile(providersYamlPath: string): Promise<string[]> {
    await access(providersYamlPath);
    const raw = await readFile(providersYamlPath, "utf-8");
    const config = parseYaml(raw) as ProvidersYaml;

    if (!config.providers || typeof config.providers !== "object") {
      throw new Error("providers.yaml must have a 'providers' object");
    }

    const registered: string[] = [];

    for (const [id, providerConfig] of Object.entries(config.providers)) {
      this.upsertProvider(id, providerConfig);
      registered.push(id);
    }

    return registered;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Register or update a provider configuration.
   */
  upsertProvider(id: string, config: ProviderLifecycleConfig): void {
    const configYaml = stringifyYaml(config);
    const now = new Date().toISOString();

    try {
      this.db
        .prepare<[string, string, string, string, string], void>(`
          INSERT INTO provider_configs (id, type, config_yaml, api_key_ref, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type       = excluded.type,
            config_yaml = excluded.config_yaml,
            api_key_ref = excluded.api_key_ref
        `)
        .run(id, config.type, configYaml, config.secret_key, now);
    } catch (err) {
      throw new Error(
        `Failed to register provider "${id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Get a registered provider by ID.
   */
  getProvider(id: string): ProviderConfigRow | undefined {
    try {
      return this.db
        .prepare<[string], ProviderConfigRow>(
          "SELECT * FROM provider_configs WHERE id = ?",
        )
        .get(id) as ProviderConfigRow | undefined;
    } catch (e: unknown) {
      logger.warn("provider-setup", "Provider configs DB query failed — returning null", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return undefined;
    }
  }

  /**
   * List all registered providers.
   */
  listProviders(): ProviderConfigRow[] {
    try {
      return this.db
        .prepare<[], ProviderConfigRow>("SELECT * FROM provider_configs ORDER BY id ASC")
        .all() as ProviderConfigRow[];
    } catch (e: unknown) {
      logger.warn("provider-setup", "Provider configs DB query failed — returning empty list", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  /**
   * Check provider connectivity by resolving API key and probing the API.
   * Updates health_status in the database.
   */
  async checkHealth(providerId: string): Promise<ProviderHealthResult> {
    const checked_at = new Date().toISOString();
    const row = this.getProvider(providerId);

    if (row === undefined) {
      return {
        provider: providerId,
        status: "unreachable",
        error: `Provider "${providerId}" not registered`,
        checked_at,
      };
    }

    // Resolve API key from secrets store
    const apiKey = this.resolveApiKey(row.api_key_ref);
    if (apiKey === undefined || apiKey.trim() === "") {
      this.updateHealthStatus(providerId, "unauthorized", checked_at);
      return {
        provider: providerId,
        status: "unauthorized",
        error: `API key not set for "${row.api_key_ref}". Run: sidjua secrets set ${row.api_key_ref} <key>`,
        checked_at,
      };
    }

    // Parse provider config for model list
    let config: ProviderLifecycleConfig;
    try {
      config = parseYaml(row.config_yaml) as ProviderLifecycleConfig;
    } catch (e: unknown) {
      logger.warn("provider-setup", "Provider config YAML parse failed — skipping provider", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      this.updateHealthStatus(providerId, "degraded", checked_at);
      return { provider: providerId, status: "degraded", error: "Invalid provider config YAML", checked_at };
    }

    const modelsAvailable = config.models?.length ?? 0;

    // Attempt minimal API probe
    const probeResult = await this.probeProvider(row.type, apiKey, config);
    const status = probeResult.success ? "healthy" : "unreachable";

    this.updateHealthStatus(providerId, status, checked_at);

    return {
      provider: providerId,
      status,
      ...(probeResult.latency_ms !== undefined ? { latency_ms: probeResult.latency_ms } : {}),
      models_available: modelsAvailable,
      ...(probeResult.error !== undefined ? { error: probeResult.error } : {}),
      checked_at,
    };
  }

  /**
   * Get models available from a registered provider.
   */
  getModels(providerId: string): ProviderModelConfig[] {
    const row = this.getProvider(providerId);
    if (row === undefined) return [];

    try {
      const config = parseYaml(row.config_yaml) as ProviderLifecycleConfig;
      return config.models ?? [];
    } catch (e: unknown) {
      logger.warn("provider-setup", "Provider config parse failed — returning empty model list", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveApiKey(keyRef: string): string | undefined {
    if (this.secretsGet !== undefined) {
      return this.secretsGet(keyRef);
    }
    // Fallback: check environment variable (for local dev)
    const envKey = keyRef.toUpperCase().replace(/-/g, "_");
    return process.env[envKey];
  }

  private async probeProvider(
    type: string,
    apiKey: string,
    config: ProviderLifecycleConfig,
  ): Promise<{ success: boolean; latency_ms?: number; error?: string }> {
    const start = Date.now();

    try {
      if (type === "anthropic") {
        const apiBase = config.api_base ?? "https://api.anthropic.com";
        const response = await fetch(`${apiBase}/v1/models`, {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(5000),
        });
        const latency_ms = Date.now() - start;

        if (response.status === 401 || response.status === 403) {
          return { success: false, latency_ms, error: "Invalid API key (401/403)" };
        }
        return { success: response.ok, latency_ms };
      }

      if (type === "openai") {
        const openaiBase = config.api_base ?? "https://api.openai.com";
        const response = await fetch(`${openaiBase}/v1/models`, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        const latency_ms = Date.now() - start;

        if (response.status === 401 || response.status === 403) {
          return { success: false, latency_ms, error: "Invalid API key (401/403)" };
        }
        return { success: response.ok, latency_ms };
      }

      // Unknown provider type — cannot probe
      return { success: false, error: `Unknown provider type "${type}" — cannot probe` };
    } catch (err) {
      return {
        success: false,
        latency_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private updateHealthStatus(providerId: string, status: string, checkedAt: string): void {
    try {
      this.db
        .prepare<[string, string, string], void>(
          "UPDATE provider_configs SET health_status = ?, last_health_check = ? WHERE id = ?",
        )
        .run(status, checkedAt, providerId);
    } catch (e: unknown) {
      logger.error("provider-setup", "Provider health status update failed — DB write error", { metadata: { error: e instanceof Error ? e.message : String(e), providerId } });
    }
  }
}
