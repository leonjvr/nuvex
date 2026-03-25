// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Approved-providers catalog tests.
 *
 * Covers:
 *   - JSON parses correctly via loadApprovedProviders()
 *   - All 8 providers have required fields
 *   - Exactly 2 free, 6 paid providers
 *   - All api_compatible = "openai"
 *   - Recommended flag on exactly 1 provider
 *   - Price ceiling values present
 */

import { describe, it, expect } from "vitest";
import { loadApprovedProviders } from "../../src/defaults/loader.js";

describe("loadApprovedProviders()", () => {
  it("parses without throwing", () => {
    expect(() => loadApprovedProviders()).not.toThrow();
  });

  it("returns a catalog with version and updated fields", () => {
    const catalog = loadApprovedProviders();
    expect(typeof catalog.version).toBe("string");
    expect(typeof catalog.updated).toBe("string");
  });

  it("returns price_ceiling with input_per_1m and output_per_1m", () => {
    const { price_ceiling } = loadApprovedProviders();
    expect(typeof price_ceiling.input_per_1m).toBe("number");
    expect(typeof price_ceiling.output_per_1m).toBe("number");
  });

  it("returns exactly 8 providers", () => {
    const { providers } = loadApprovedProviders();
    expect(providers).toHaveLength(8);
  });

  it("each provider has all required fields", () => {
    const { providers } = loadApprovedProviders();
    const REQUIRED = ["id", "name", "model", "display_name", "tier", "quality",
      "input_price", "output_price", "rate_limit", "api_base", "signup_url",
      "info", "recommended", "api_compatible"] as const;
    for (const p of providers) {
      for (const field of REQUIRED) {
        expect(p[field], `${p.id} missing ${field}`).toBeDefined();
      }
    }
  });

  it("id is a non-empty string for each provider", () => {
    const { providers } = loadApprovedProviders();
    for (const p of providers) {
      expect(typeof p.id).toBe("string");
      expect(p.id.trim()).not.toBe("");
    }
  });

  it("has exactly 2 free-tier providers", () => {
    const { providers } = loadApprovedProviders();
    const free = providers.filter((p) => p.tier === "free");
    expect(free).toHaveLength(2);
  });

  it("has exactly 6 paid-tier providers", () => {
    const { providers } = loadApprovedProviders();
    const paid = providers.filter((p) => p.tier === "paid");
    expect(paid).toHaveLength(6);
  });

  it("all api_compatible values are 'openai'", () => {
    const { providers } = loadApprovedProviders();
    for (const p of providers) {
      expect(p.api_compatible).toBe("openai");
    }
  });

  it("recommended flag is set on exactly 1 provider", () => {
    const { providers } = loadApprovedProviders();
    const recommended = providers.filter((p) => p.recommended === true);
    expect(recommended).toHaveLength(1);
  });

  it("the recommended provider is groq-llama70b-free", () => {
    const { providers } = loadApprovedProviders();
    const rec = providers.find((p) => p.recommended);
    expect(rec?.id).toBe("groq-llama70b-free");
  });

  it("free providers have input_price and output_price of 0", () => {
    const { providers } = loadApprovedProviders();
    for (const p of providers.filter((p) => p.tier === "free")) {
      expect(p.input_price).toBe(0);
      expect(p.output_price).toBe(0);
    }
  });

  it("paid providers have numeric prices", () => {
    const { providers } = loadApprovedProviders();
    for (const p of providers.filter((p) => p.tier === "paid")) {
      expect(typeof p.input_price).toBe("number");
      expect(typeof p.output_price).toBe("number");
    }
  });

  it("all api_base values start with https://", () => {
    const { providers } = loadApprovedProviders();
    for (const p of providers) {
      expect(p.api_base, `${p.id} api_base should be https`).toMatch(/^https:\/\//);
    }
  });

  it("all provider IDs are unique", () => {
    const { providers } = loadApprovedProviders();
    const ids = providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
