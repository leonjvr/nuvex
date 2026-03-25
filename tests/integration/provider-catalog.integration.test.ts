/**
 * Phase 13d — Provider Catalog Integration Tests (env-gated)
 *
 * These tests make REAL API calls to provider endpoints.
 * Only run when SIDJUA_INTEGRATION_TESTS=1 is set.
 *
 * Required env vars (at least one):
 *   ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY
 */

import { describe, it, expect } from "vitest";
import { ProviderAutoDetect } from "../../src/providers/auto-detect.js";
import { ProviderKeyManager } from "../../src/providers/key-manager.js";
import { ProviderCatalog }    from "../../src/providers/catalog.js";

const INTEGRATION = process.env["SIDJUA_INTEGRATION_TESTS"] === "1";

describe.skipIf(!INTEGRATION)("Provider catalog integration tests (real API)", () => {
  it("should probe Anthropic endpoint and detect capabilities", async () => {
    const keyManager = new ProviderKeyManager();
    const hasKey     = await keyManager.hasKey("anthropic");

    if (!hasKey) {
      console.info("[skip] ANTHROPIC_API_KEY not set");
      return;
    }

    const apiKey  = await keyManager.getKey("anthropic");
    const catalog = new ProviderCatalog();
    const models  = catalog.getModels("anthropic");
    const model   = models[1]?.id ?? "claude-haiku-4-5-20251001";  // use smallest

    const detector = new ProviderAutoDetect();
    const result   = await detector.probe({
      base_url: "https://api.anthropic.com",
      api_key:  apiKey,
      model,
    });

    // Anthropic uses its own API format — /models may not be OpenAI-compatible
    // but the endpoint should be alive
    expect(result.alive).toBe(true);
    expect(result.response_time_ms).toBeGreaterThan(0);
  }, 60_000);

  it("should probe DeepSeek endpoint and detect chat support", async () => {
    const keyManager = new ProviderKeyManager();
    const hasKey     = await keyManager.hasKey("deepseek");

    if (!hasKey) {
      console.info("[skip] DEEPSEEK_API_KEY not set");
      return;
    }

    const apiKey   = await keyManager.getKey("deepseek");
    const detector = new ProviderAutoDetect();
    const result   = await detector.probe({
      base_url: "https://api.deepseek.com/v1",
      api_key:  apiKey,
      model:    "deepseek-chat",
    });

    expect(result.alive).toBe(true);
    expect(result.chat_completions).toBe(true);
    expect(result.response_time_ms).toBeGreaterThan(0);
  }, 60_000);

  it("should list available models from catalog for all known providers", () => {
    const catalog = new ProviderCatalog();
    const all     = catalog.getAll();

    // All builtin cloud providers should have at least one model
    const cloud = catalog.getCloud();
    for (const p of cloud) {
      expect(p.models.length, `${p.id} should have models`).toBeGreaterThan(0);
    }

    // Local providers may have empty model lists (user-defined)
    const local = catalog.getLocal();
    for (const p of local) {
      expect(p.id).toBeTruthy();
    }

    expect(all.length).toBe(20); // 12 + 8
  });
});
