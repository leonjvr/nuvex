/**
 * Phase 13a: ProviderKeyManager unit tests
 *
 * Tests the layered key resolution (env var → .env file → PROV-005).
 * Mocks node:fs to control .env file content.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mock so it applies before ProviderKeyManager imports readFileSync
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => {
    // Default: simulate missing .env file
    throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  }),
}));

import { readFileSync }       from "node:fs";
import { ProviderKeyManager } from "../../src/providers/key-manager.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let manager: ProviderKeyManager;

beforeEach(() => {
  manager = new ProviderKeyManager();
  // Reset the module-level dotenv cache between tests
  manager.clearCache();
  // Reset readFileSync mock to default (throw ENOENT)
  vi.mocked(readFileSync).mockImplementation(() => {
    throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProviderKeyManager.getKey", () => {
  it("resolves API key from environment variable", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-from-env-12345");

    const key = await manager.getKey("anthropic");

    expect(key).toBe("sk-from-env-12345");
  });

  it("resolves API key from .env file when env var is absent", async () => {
    // Ensure no env var is set
    delete process.env["ANTHROPIC_API_KEY"];

    // Simulate a .env file with the key
    vi.mocked(readFileSync).mockReturnValue("ANTHROPIC_API_KEY=sk-from-dotenv-99999\n");

    const key = await manager.getKey("anthropic");

    expect(key).toBe("sk-from-dotenv-99999");
  });

  it("throws PROV-005 when no key is available from any source", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    // readFileSync already throws ENOENT (default mock)

    await expect(manager.getKey("anthropic")).rejects.toMatchObject({ code: "PROV-005" });
  });
});

describe("ProviderKeyManager.listAvailableProviders", () => {
  it("returns only providers that have a key configured", async () => {
    // Set keys for anthropic and deepseek only
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthro-key");
    vi.stubEnv("DEEPSEEK_API_KEY",  "ds-deep-key");
    // Ensure others are absent
    delete process.env["OPENAI_API_KEY"];
    delete process.env["CLOUDFLARE_AI_API_KEY"];
    delete process.env["GROK_API_KEY"];
    delete process.env["KIMI_API_KEY"];

    const available = await manager.listAvailableProviders();

    expect(available).toContain("anthropic");
    expect(available).toContain("deepseek");
    expect(available).not.toContain("openai");
    expect(available).not.toContain("cloudflare-ai");
  });
});
