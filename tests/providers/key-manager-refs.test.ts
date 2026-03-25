/**
 * Tests for Phase 13d: ProviderKeyManager named key refs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProviderKeyManager } from "../../src/providers/key-manager.js";
import { SidjuaError } from "../../src/core/error-codes.js";

describe("ProviderKeyManager — named key refs", () => {
  let manager: ProviderKeyManager;

  beforeEach(() => {
    manager = new ProviderKeyManager();
    manager.clearCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should add and retrieve a key ref by name", () => {
    manager.addKeyRef({
      name:     "prod-anthropic",
      provider: "anthropic",
      source:   "env:ANTHROPIC_API_KEY",
    });

    const ref = manager.getKeyByRef("prod-anthropic");
    expect(ref).toBeDefined();
    expect(ref?.name).toBe("prod-anthropic");
    expect(ref?.provider).toBe("anthropic");
    expect(ref?.source).toBe("env:ANTHROPIC_API_KEY");
  });

  it("should reject duplicate key ref names", () => {
    manager.addKeyRef({
      name:     "my-key",
      provider: "openai",
      source:   "env:OPENAI_API_KEY",
    });

    expect(() =>
      manager.addKeyRef({
        name:     "my-key",
        provider: "deepseek",
        source:   "env:DEEPSEEK_API_KEY",
      }),
    ).toThrow(SidjuaError);
  });

  it("should list and remove key refs", () => {
    manager.addKeyRef({ name: "key-a", provider: "anthropic", source: "env:ANTHROPIC_API_KEY" });
    manager.addKeyRef({ name: "key-b", provider: "openai",    source: "env:OPENAI_API_KEY" });

    expect(manager.listKeyRefs()).toHaveLength(2);

    manager.removeKeyRef("key-a");
    expect(manager.listKeyRefs()).toHaveLength(1);
    expect(manager.getKeyByRef("key-a")).toBeUndefined();

    // removeKeyRef is no-op for non-existent
    manager.removeKeyRef("nonexistent"); // should not throw
  });

  it("should resolve env: source refs", async () => {
    vi.stubEnv("MY_TEST_API_KEY", "sk-test-resolved-value");

    manager.addKeyRef({
      name:     "test-key",
      provider: "anthropic",
      source:   "env:MY_TEST_API_KEY",
    });

    const value = await manager.resolveKeyRef("test-key");
    expect(value).toBe("sk-test-resolved-value");
  });

  it("should resolve literal: source refs", async () => {
    manager.addKeyRef({
      name:     "literal-key",
      provider: "deepseek",
      source:   "literal:sk-literal-key-value",
    });

    const value = await manager.resolveKeyRef("literal-key");
    expect(value).toBe("sk-literal-key-value");
  });

  it("should throw PROV-005 if env var not set", async () => {
    vi.stubEnv("MISSING_VAR_12345", undefined as unknown as string);
    delete process.env["MISSING_VAR_12345"];

    manager.addKeyRef({
      name:     "missing-key",
      provider: "openai",
      source:   "env:MISSING_VAR_12345",
    });

    await expect(manager.resolveKeyRef("missing-key")).rejects.toThrow(SidjuaError);
  });

  it("should throw PROV-005 for unknown key ref name", async () => {
    await expect(manager.resolveKeyRef("does-not-exist")).rejects.toThrow(SidjuaError);
  });
});
