/**
 * Tests for Phase 13d: CustomProviderManager
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CustomProviderManager } from "../../src/providers/custom-provider.js";
import { ProviderCatalog, resetDefaultCatalog } from "../../src/providers/catalog.js";
import { SidjuaError } from "../../src/core/error-codes.js";
import type { ProviderAdapterRegistry } from "../../src/providers/registry.js";

// ---------------------------------------------------------------------------
// Mock registry
// ---------------------------------------------------------------------------

function makeMockRegistry(): ProviderAdapterRegistry {
  return {
    register:     vi.fn(),
    unregister:   vi.fn(),
    get:          vi.fn(),
    list:         vi.fn().mockReturnValue([]),
    hasAny:       vi.fn().mockReturnValue(false),
  } as unknown as ProviderAdapterRegistry;
}

describe("CustomProviderManager", () => {
  let catalog:  ProviderCatalog;

  beforeEach(() => {
    resetDefaultCatalog();
    catalog = new ProviderCatalog();
  });

  it("should add a custom provider and register an adapter", async () => {
    const registry = makeMockRegistry();
    const manager  = new CustomProviderManager(catalog, registry);

    const entry = await manager.add({
      id:                "my-server",
      name:              "My Private Server",
      base_url:          "https://my-server.example.com/v1",
      api_key_required:  true,
      models:            ["model-a"],
      supports_tool_use: true,
    });

    expect(entry.id).toBe("my-server");
    expect(entry.category).toBe("custom");
    expect(registry.register).toHaveBeenCalledWith("my-server", expect.objectContaining({}));

    // Appears in catalog
    expect(catalog.getById("my-server")).toBeDefined();
  });

  it("should validate provider ID format", async () => {
    const manager = new CustomProviderManager(catalog);

    await expect(manager.add({
      id:                "INVALID ID",       // uppercase + space
      name:              "Bad Provider",
      base_url:          "https://example.com/v1",
      api_key_required:  false,
      models:            ["model"],
      supports_tool_use: false,
    })).rejects.toThrow(SidjuaError);

    await expect(manager.add({
      id:                "",
      name:              "Empty ID",
      base_url:          "https://example.com/v1",
      api_key_required:  false,
      models:            ["model"],
      supports_tool_use: false,
    })).rejects.toThrow(SidjuaError);
  });

  it("should validate base_url format", async () => {
    const manager = new CustomProviderManager(catalog);

    await expect(manager.add({
      id:                "bad-url",
      name:              "Bad URL",
      base_url:          "ftp://not-http.example.com",  // not http
      api_key_required:  false,
      models:            ["model"],
      supports_tool_use: false,
    })).rejects.toThrow(SidjuaError);
  });

  it("should remove a custom provider and unregister adapter", async () => {
    const registry = makeMockRegistry();
    const manager  = new CustomProviderManager(catalog, registry);

    await manager.add({
      id:                "temp-provider",
      name:              "Temp",
      base_url:          "https://temp.example.com/v1",
      api_key_required:  false,
      models:            ["model"],
      supports_tool_use: false,
    });

    expect(catalog.getById("temp-provider")).toBeDefined();

    await manager.remove("temp-provider");

    expect(catalog.getById("temp-provider")).toBeUndefined();
    expect(registry.unregister).toHaveBeenCalledWith("temp-provider");
  });

  it("should list custom providers", async () => {
    const manager = new CustomProviderManager(catalog);

    expect(manager.list()).toHaveLength(0);

    await manager.add({
      id:                "prov-a",
      name:              "Provider A",
      base_url:          "https://a.example.com/v1",
      api_key_required:  false,
      models:            ["model"],
      supports_tool_use: false,
    });

    await manager.add({
      id:                "prov-b",
      name:              "Provider B",
      base_url:          "https://b.example.com/v1",
      api_key_required:  true,
      models:            ["model"],
      supports_tool_use: true,
    });

    expect(manager.list()).toHaveLength(2);
  });
});
