// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider selftest checks
 *
 * ProviderApiKeyValid, ProviderConnectivity
 *
 * Skipped on fresh installations with no providers configured.
 */

import type { SelftestCheck, SelftestContext, CheckResult } from "../selftest-runner.js";
import { getProviderConfig } from "../../provider-config.js";
import type { ProviderConfig } from "../../provider-config.js";

const CAT = "provider";

const KNOWN_PROVIDERS: Array<{
  name:    string;
  envKey:  string;
  testUrl: string;
}> = [
  {
    name:    "openai",
    envKey:  "OPENAI_API_KEY",
    testUrl: "https://api.openai.com/v1/models",
  },
  {
    name:    "anthropic",
    envKey:  "ANTHROPIC_API_KEY",
    testUrl: "https://api.anthropic.com/v1/models",
  },
  {
    name:    "cloudflare",
    envKey:  "CLOUDFLARE_API_KEY",
    testUrl: "https://api.cloudflare.com/client/v4/user",
  },
];

/** Load the persisted provider config; returns null if unavailable. */
function tryLoadPersistedConfig(): ProviderConfig | null {
  try { return getProviderConfig(); } catch (_e) { return null; }
}

/**
 * Check whether a provider is configured — prefers the persisted encrypted
 * config over environment variables so credentials do not need to be set in
 * the environment on every invocation.
 */
function isProviderConfigured(
  p: { name: string; envKey: string },
  persisted: ProviderConfig | null,
): boolean {
  // 1. Persisted config takes priority (credentials stored by `sidjua setup`)
  if (persisted !== null) {
    if (persisted.default_provider?.provider_id === p.name) return true;
    if (Object.values(persisted.agent_overrides).some((o) => o.provider_id === p.name)) return true;
  }
  // 2. Fall back to environment variable
  const val = process.env[p.envKey];
  return val !== undefined && val.trim().length > 0;
}

/** Return the API key for a provider (persisted config first, then env var). */
function getProviderApiKey(
  p: { name: string; envKey: string },
  persisted: ProviderConfig | null,
): string {
  if (persisted !== null) {
    if (persisted.default_provider?.provider_id === p.name) {
      return persisted.default_provider.api_key;
    }
    const override = Object.values(persisted.agent_overrides).find((o) => o.provider_id === p.name);
    if (override !== undefined) return override.api_key;
  }
  return process.env[p.envKey] ?? "";
}


export const ProviderApiKeyValid: SelftestCheck = {
  name:     "Provider API keys configured",
  category: CAT,

  async run(_ctx: SelftestContext): Promise<CheckResult> {
    const t        = Date.now();
    const persisted = tryLoadPersistedConfig();

    const configured = KNOWN_PROVIDERS.filter((p) => isProviderConfigured(p, persisted));
    const missing    = KNOWN_PROVIDERS.filter((p) => !isProviderConfigured(p, persisted));

    if (configured.length === 0) {
      return {
        name:      this.name,
        category:  CAT,
        status:    "skip",
        message:   "No provider API keys configured — run: sidjua setup",
        duration:  Date.now() - t,
        fixable:   true,
        fixAction: "Configure at least one provider: sidjua setup",
      };
    }

    const details =
      configured.map((p) => `${p.name}: key present`).join(", ") +
      (missing.length > 0 ? ` | not configured: ${missing.map((p) => p.name).join(", ")}` : "");

    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  `${configured.length} provider(s) configured: ${configured.map((p) => p.name).join(", ")}`,
      duration: Date.now() - t,
      fixable:  false,
      details,
    };
  },
};


/** Timeout for provider test requests (ms). */
const PROVIDER_TIMEOUT_MS = 5_000;
/** Warn threshold for slow responses (ms). */
const SLOW_THRESHOLD_MS   = 2_000;

export const ProviderConnectivity: SelftestCheck = {
  name:     "Provider connectivity",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t         = Date.now();
    const persisted  = tryLoadPersistedConfig();

    const configured = KNOWN_PROVIDERS.filter((p) => isProviderConfigured(p, persisted));
    if (configured.length === 0) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "No providers configured — skipping connectivity check",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    // Connectivity checks are opt-in — skip unless explicitly enabled.
    const connectivityEnabled =
      ctx.checkConnectivity === true ||
      process.env["SIDJUA_SELFTEST_CONNECTIVITY"] === "1";

    if (!connectivityEnabled) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "Connectivity check skipped (opt-in via --check-connectivity or SIDJUA_SELFTEST_CONNECTIVITY=1)",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    const providerResults: Array<{ name: string; ok: boolean; latencyMs: number; error?: string }> = [];

    for (const p of configured) {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
        try {
          const resp = await fetch(p.testUrl, {
            method:  "GET",
            headers: { "Authorization": `Bearer ${getProviderApiKey(p, persisted)}` },
            signal:  controller.signal,
          });
          clearTimeout(timer);
          // 401/403 = key invalid but network OK; treat as warn, not fail
          const latencyMs = Date.now() - start;
          providerResults.push({ name: p.name, ok: resp.status < 500, latencyMs });
        } finally {
          clearTimeout(timer);
        }
      } catch (e: unknown) {
        providerResults.push({
          name:      p.name,
          ok:        false,
          latencyMs: Date.now() - start,
          error:     e instanceof Error ? e.message : String(e),
        });
      }
    }

    const failed  = providerResults.filter((r) => !r.ok);
    const slow    = providerResults.filter((r) => r.ok && r.latencyMs > SLOW_THRESHOLD_MS);
    const details = ctx.verbose
      ? providerResults.map((r) => `${r.name}: ${r.ok ? "OK" : "FAIL"} ${r.latencyMs}ms${r.error ? ` (${r.error})` : ""}`).join(", ")
      : undefined;

    if (failed.length > 0) {
      return {
        name:      this.name,
        category:  CAT,
        status:    "warn",
        message:   `Provider connectivity issues: ${failed.map((r) => `${r.name}${r.error ? ` (${r.error})` : ""}`).join(", ")}`,
        duration:  Date.now() - t,
        fixable:   false,
        fixAction: "Check provider API keys and network connectivity",
        details,
      };
    }

    if (slow.length > 0) {
      return {
        name:     this.name,
        category: CAT,
        status:   "warn",
        message:  `Slow provider response: ${slow.map((r) => `${r.name} (${r.latencyMs}ms)`).join(", ")}`,
        duration: Date.now() - t,
        fixable:  false,
        fixAction: `Check provider ${slow.map((r) => r.name).join(", ")} — response time exceeds ${SLOW_THRESHOLD_MS}ms`,
        details,
      };
    }

    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  providerResults.map((r) => `${r.name} (${r.latencyMs}ms)`).join(", "),
      duration: Date.now() - t,
      fixable:  false,
      details,
    };
  },
};

