/**
 * Tests for Phase 13d: SetupAssistant
 *
 * Uses placeholder credentials so the assistant always degrades to docs.
 * No real Cloudflare API calls are made.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { SetupAssistant } from "../../src/setup/setup-assistant.js";
import { ProviderCatalog } from "../../src/providers/catalog.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("SetupAssistant", () => {
  it("should degrade gracefully with placeholder credentials (no fetch)", async () => {
    // Ensure no real credentials in env
    delete process.env["CLOUDFLARE_ACCOUNT_ID"];
    delete process.env["CLOUDFLARE_AI_API_KEY"];

    const assistant = new SetupAssistant();
    // With placeholder creds, fetch should NOT be called
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("should not be called")));

    const response = await assistant.ask({ topic: "getting started" });

    expect(response.fromAssistant).toBe(false);  // degraded to docs
    expect(response.answer).toBeTruthy();
    expect(typeof response.answer).toBe("string");
  });

  it("should return correct doc section based on topic", async () => {
    const assistant = new SetupAssistant();

    const providerResponse = await assistant.ask({ topic: "provider selection and api keys" });
    expect(providerResponse.docSection).toBe("provider-guide");

    const modelResponse = await assistant.ask({ topic: "model recommendations" });
    expect(modelResponse.docSection).toBe("model-recommendations");

    const defaultResponse = await assistant.ask({ topic: "general setup" });
    expect(defaultResponse.docSection).toBe("quick-start");
  });

  it("should validate provider configuration correctly", () => {
    const assistant = new SetupAssistant();

    // Empty catalog → warning, not error
    const emptyResult = assistant.validateProviderConfig([]);
    expect(emptyResult.valid).toBe(true);       // no issues (only warnings)
    expect(emptyResult.warnings.length).toBeGreaterThan(0);

    // A cloud-only provider catalog → warns about local fallback
    const catalog        = new ProviderCatalog();
    const cloudProviders = catalog.getCloud().slice(0, 2); // just 2 cloud providers
    const cloudResult    = assistant.validateProviderConfig(cloudProviders);
    expect(cloudResult.warnings.some((w) => w.includes("local"))).toBe(true);

    // Provider with no models → issue
    const badProvider = {
      id:               "no-models",
      name:             "No Models",
      category:         "cloud" as const,
      api_format:       "openai-compatible" as const,
      default_base_url: "https://example.com",
      requires_api_key: true,
      models:           [],
      pricing_tier:     "unknown" as const,
    };
    const badResult = assistant.validateProviderConfig([badProvider]);
    expect(badResult.valid).toBe(false);
    expect(badResult.issues.length).toBeGreaterThan(0);
  });

  it("loadDoc returns content or fallback message", () => {
    const assistant = new SetupAssistant();

    const quickStart = assistant.loadDoc("quick-start");
    // Either real content or a fallback — must be a non-empty string
    expect(typeof quickStart).toBe("string");
    expect(quickStart.length).toBeGreaterThan(0);

    const providerGuide = assistant.loadDoc("provider-guide");
    expect(typeof providerGuide).toBe("string");
    expect(providerGuide.length).toBeGreaterThan(0);

    const modelRecs = assistant.loadDoc("model-recommendations");
    expect(typeof modelRecs).toBe("string");
    expect(modelRecs.length).toBeGreaterThan(0);
  });
});
