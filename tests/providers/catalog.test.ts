/**
 * Tests for Phase 13d: ProviderCatalog
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ProviderCatalog, resetDefaultCatalog, getDefaultCatalog } from "../../src/providers/catalog.js";
import { SidjuaError } from "../../src/core/error-codes.js";

describe("ProviderCatalog", () => {
  beforeEach(() => {
    resetDefaultCatalog();
  });

  it("should return 13 cloud + 8 local providers from the builtin catalog", () => {
    const catalog = new ProviderCatalog();
    const cloud   = catalog.getCloud();
    const local   = catalog.getLocal();

    expect(cloud).toHaveLength(13);
    expect(local).toHaveLength(8);
    expect(catalog.getAll()).toHaveLength(21); // no custom initially
  });

  it("should look up builtin providers by ID", () => {
    const catalog = new ProviderCatalog();

    const anthropic = catalog.getById("anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic?.category).toBe("cloud");
    expect(anthropic?.models.length).toBeGreaterThan(0);

    const ollama = catalog.getById("ollama");
    expect(ollama).toBeDefined();
    expect(ollama?.category).toBe("local");

    expect(catalog.getById("nonexistent")).toBeUndefined();
  });

  it("should add and retrieve custom providers", () => {
    const catalog = new ProviderCatalog();

    const entry = catalog.addCustom({
      id:                "my-custom",
      name:              "My Custom Provider",
      base_url:          "https://custom.example.com/v1",
      api_key_required:  true,
      models:            ["custom-model-1", "custom-model-2"],
      supports_tool_use: true,
    });

    expect(entry.id).toBe("my-custom");
    expect(entry.category).toBe("custom");
    expect(entry.models).toHaveLength(2);
    expect(entry.models[0]?.id).toBe("custom-model-1");

    const custom = catalog.getCustom();
    expect(custom).toHaveLength(1);

    const all = catalog.getAll();
    expect(all).toHaveLength(22); // 21 builtins + 1 custom
  });

  it("should reject duplicate IDs when adding custom provider", () => {
    const catalog = new ProviderCatalog();

    // Collision with builtin
    expect(() =>
      catalog.addCustom({
        id:                "anthropic",
        name:              "Fake Anthropic",
        base_url:          "https://fake.com/v1",
        api_key_required:  true,
        models:            ["model"],
        supports_tool_use: false,
      }),
    ).toThrow(SidjuaError);

    // Add first custom
    catalog.addCustom({
      id:                "unique-id",
      name:              "Provider A",
      base_url:          "https://a.example.com/v1",
      api_key_required:  false,
      models:            ["model-a"],
      supports_tool_use: false,
    });

    // Duplicate custom
    expect(() =>
      catalog.addCustom({
        id:                "unique-id",
        name:              "Provider A duplicate",
        base_url:          "https://b.example.com/v1",
        api_key_required:  false,
        models:            ["model-b"],
        supports_tool_use: false,
      }),
    ).toThrow(SidjuaError);
  });

  it("should remove custom providers", () => {
    const catalog = new ProviderCatalog();

    catalog.addCustom({
      id:                "removable",
      name:              "Removable Provider",
      base_url:          "https://removable.example.com/v1",
      api_key_required:  false,
      models:            ["model"],
      supports_tool_use: false,
    });

    expect(catalog.getCustom()).toHaveLength(1);

    catalog.removeCustom("removable");
    expect(catalog.getCustom()).toHaveLength(0);

    // Removing non-existent throws
    expect(() => catalog.removeCustom("nonexistent")).toThrow(SidjuaError);
  });

  it("getDefaultCatalog returns singleton", () => {
    const a = getDefaultCatalog();
    const b = getDefaultCatalog();
    expect(a).toBe(b);

    resetDefaultCatalog();
    const c = getDefaultCatalog();
    expect(c).not.toBe(a);
  });
});
