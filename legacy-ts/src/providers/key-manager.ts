// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13a: Provider Key Manager
 *
 * Resolves API keys for each LLM provider with a layered fallback chain:
 *   1. Environment variable  (ANTHROPIC_API_KEY, OPENAI_API_KEY, …)
 *   2. .env file in process.cwd()  (dotenv-compatible, no external dep)
 *   3. SidjuaError PROV-005 (authentication failed)
 *
 * Keys are cached in memory after the first successful resolution.
 * Session-duration cache only — no persistence across restarts.
 *
 * For Cloudflare, CLOUDFLARE_ACCOUNT_ID is also resolved alongside
 * CLOUDFLARE_AI_API_KEY.
 */

import { readFileSync } from "node:fs";
import { resolve }      from "node:path";
import { createLogger } from "../core/logger.js";
import { SidjuaError }  from "../core/error-codes.js";


/** A named key reference stored in sidjua.yaml — never stores the actual value. */
export interface KeyRef {
  /** Short label, e.g. "prod-anthropic" or "my-deepseek" */
  name:     string;
  /** Source spec: "env:VAR_NAME" | "vault:path/to/secret" | "literal:<redacted>" */
  source:   string;
  /** Provider this key is for, e.g. "anthropic" | "deepseek" | custom-id */
  provider: string;
  /** Optional: restrict to specific agents */
  agents?:  string[];
}

const logger = createLogger("providers");


const ENV_VAR_MAP: Record<string, string> = {
  anthropic:     "ANTHROPIC_API_KEY",
  openai:        "OPENAI_API_KEY",
  deepseek:      "DEEPSEEK_API_KEY",
  "cloudflare-ai": "CLOUDFLARE_AI_API_KEY",
  grok:          "GROK_API_KEY",
  kimi:          "KIMI_API_KEY",
};


/** Parse a dotenv-compatible file into a key→value map. */
function parseDotenv(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key   = line.slice(0, eq).trim();
    let   value = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"')  && value.endsWith('"'))  ||
      (value.startsWith("'")  && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result.set(key, value);
  }
  return result;
}

let _dotenvCache: Map<string, string> | null = null;

/** Module-level key ref store — shared across all ProviderKeyManager instances. */
const _keyRefStore = new Map<string, KeyRef>();

function getDotenv(): Map<string, string> {
  if (_dotenvCache !== null) return _dotenvCache;
  try {
    const path    = resolve(process.cwd(), ".env");
    const content = readFileSync(path, "utf-8");
    _dotenvCache  = parseDotenv(content);
  } catch (e: unknown) {
    logger.debug("key-manager", ".env file not readable — skipping env var injection", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    _dotenvCache = new Map();
  }
  return _dotenvCache;
}


export class ProviderKeyManager {
  private readonly cache = new Map<string, string>();

  /**
   * Resolve the API key for the given provider.
   *
   * @throws SidjuaError(PROV-005) if no key is found.
   */
  async getKey(provider: string): Promise<string> {
    const cached = this.cache.get(provider);
    if (cached !== undefined) return cached;

    const envVar = ENV_VAR_MAP[provider];

    // 1. Environment variable
    if (envVar !== undefined) {
      const envVal = process.env[envVar];
      if (envVal) {
        this.cache.set(provider, envVal);
        logger.info("key_resolved", `API key for ${provider} resolved from environment`, {
          metadata: { provider, source: "env" },
        });
        return envVal;
      }
    }

    // 2. .env file
    const dotenv = getDotenv();
    if (envVar !== undefined) {
      const dotenvVal = dotenv.get(envVar);
      if (dotenvVal) {
        this.cache.set(provider, dotenvVal);
        logger.info("key_resolved", `API key for ${provider} resolved from .env file`, {
          metadata: { provider, source: ".env" },
        });
        return dotenvVal;
      }
    }

    // 3. Not found
    throw SidjuaError.from(
      "PROV-005",
      `No API key found for provider "${provider}". ` +
      `Set ${envVar ?? `the appropriate env var`} or add it to .env`,
    );
  }

  /** Return true if a key is available without throwing. */
  async hasKey(provider: string): Promise<boolean> {
    try {
      await this.getKey(provider);
      return true;
    } catch (e: unknown) {
      logger.warn("key-manager", "Key reference resolution failed — treating as invalid", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  /**
   * Return names of providers that currently have a key configured.
   * Only checks providers known in ENV_VAR_MAP.
   */
  async listAvailableProviders(): Promise<string[]> {
    const available: string[] = [];
    for (const provider of Object.keys(ENV_VAR_MAP)) {
      if (await this.hasKey(provider)) {
        available.push(provider);
      }
    }
    return available;
  }

  /**
   * Validate a key by making a lightweight API call.
   * Returns true if the key is accepted, false on 401.
   *
   * For Cloudflare, also resolves CLOUDFLARE_ACCOUNT_ID.
   */
  async validateKey(provider: string): Promise<boolean> {
    try {
      const key = await this.getKey(provider);
      return await pingProvider(provider, key);
    } catch (e: unknown) {
      logger.warn("key-manager", "Provider ping failed during key validation — treating as invalid", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  /** Resolve the Cloudflare account ID from env or .env. */
  async getCloudflareAccountId(): Promise<string | undefined> {
    const fromEnv = process.env["CLOUDFLARE_ACCOUNT_ID"];
    if (fromEnv) return fromEnv;
    return getDotenv().get("CLOUDFLARE_ACCOUNT_ID");
  }

  /** Invalidate the in-memory cache and key ref store (useful in tests). */
  clearCache(): void {
    this.cache.clear();
    _dotenvCache = null;
    _keyRefStore.clear();
  }

  // ---------------------------------------------------------------------------
  // Named key references (Phase 13d)
  // ---------------------------------------------------------------------------

  /**
   * Register a named key reference.
   * The `source` field describes where to find the key, not the key itself.
   * Supports "env:VAR_NAME" and "literal:VALUE" sources.
   *
   * @throws SidjuaError(PROV-009) if name is already registered.
   */
  addKeyRef(ref: KeyRef): void {
    if (_keyRefStore.has(ref.name)) {
      throw SidjuaError.from("PROV-009", `Key ref "${ref.name}" already registered`);
    }
    _keyRefStore.set(ref.name, ref);
    logger.info("key_ref_added", `Key ref "${ref.name}" registered for provider ${ref.provider}`, {
      metadata: { name: ref.name, provider: ref.provider, source: ref.source.split(":")[0] },
    });
  }

  /**
   * Look up a named key reference by name.
   * Returns undefined if not found.
   */
  getKeyByRef(name: string): KeyRef | undefined {
    return _keyRefStore.get(name);
  }

  /** List all registered named key references (without actual key values). */
  listKeyRefs(): KeyRef[] {
    return [..._keyRefStore.values()];
  }

  /** Remove a named key reference. No-op if not found. */
  removeKeyRef(name: string): void {
    _keyRefStore.delete(name);
    logger.info("key_ref_removed", `Key ref "${name}" removed`, { metadata: { name } });
  }

  /**
   * Resolve the actual key value from a named key reference source.
   * Supports "env:VAR_NAME" and "literal:VALUE" sources.
   *
   * @throws SidjuaError(PROV-005) if ref not found or key cannot be resolved.
   */
  async resolveKeyRef(name: string): Promise<string> {
    const ref = _keyRefStore.get(name);
    if (ref === undefined) {
      throw SidjuaError.from("PROV-005", `Key ref "${name}" not found`);
    }

    const [sourceType, ...rest] = ref.source.split(":");
    const sourceValue = rest.join(":");

    if (sourceType === "env") {
      const val = process.env[sourceValue] ?? getDotenv().get(sourceValue);
      if (val) return val;
      throw SidjuaError.from("PROV-005", `Key ref "${name}": env var ${sourceValue} not set`);
    }

    if (sourceType === "literal") {
      if (sourceValue) return sourceValue;
      throw SidjuaError.from("PROV-005", `Key ref "${name}": literal value is empty`);
    }

    throw SidjuaError.from("PROV-005", `Key ref "${name}": unsupported source type "${sourceType}"`);
  }

  /**
   * Validate a named key reference by resolving the key and pinging the provider.
   * Returns true if the key is valid, false otherwise.
   */
  async validateKeyRef(name: string): Promise<boolean> {
    try {
      const ref = _keyRefStore.get(name);
      if (ref === undefined) return false;
      const key = await this.resolveKeyRef(name);
      return await pingProvider(ref.provider, key);
    } catch (e: unknown) {
      logger.warn("key-manager", "Named key validation failed — treating as invalid", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }
}


async function pingProvider(provider: string, apiKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 10_000);

  try {
    let url:     string;
    let headers: Record<string, string>;

    switch (provider) {
      case "anthropic":
        url     = "https://api.anthropic.com/v1/models";
        headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
        break;
      case "openai":
        url     = "https://api.openai.com/v1/models";
        headers = { "Authorization": `Bearer ${apiKey}` };
        break;
      case "deepseek":
        url     = "https://api.deepseek.com/v1/models";
        headers = { "Authorization": `Bearer ${apiKey}` };
        break;
      case "grok":
        url     = "https://api.x.ai/v1/models";
        headers = { "Authorization": `Bearer ${apiKey}` };
        break;
      case "kimi":
        url     = "https://api.moonshot.ai/v1/models";
        headers = { "Authorization": `Bearer ${apiKey}` };
        break;
      default:
        return true; // can't validate unknown provider, assume OK
    }

    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    return res.status !== 401;
  } catch (e: unknown) {
    logger.warn("key-manager", "Provider ping network failure — treating as unreachable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return false;
  } finally {
    clearTimeout(timer);
  }
}
