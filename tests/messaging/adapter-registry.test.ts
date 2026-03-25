/**
 * V1.1 — AdapterRegistry unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdapterRegistry, type PluginLoader } from "../../src/messaging/adapter-registry.js";
import type {
  MessagingAdapterPlugin,
  AdapterInstance,
  AdapterCallbacks,
} from "../../src/messaging/adapter-plugin.js";
import type { AdapterInstanceConfig } from "../../src/messaging/types.js";
import { existsSync, statSync, readdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// fs mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    existsSync:  vi.fn(),
    statSync:    vi.fn(),
    readdirSync: vi.fn(),
  };
});

const mockExistsSync  = vi.mocked(existsSync);
const mockStatSync    = vi.mocked(statSync);
const mockReaddirSync = vi.mocked(readdirSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(name = "test-adapter", channel = "test"): MessagingAdapterPlugin {
  return {
    meta: {
      name,
      version:      "1.0.0",
      description:  "Test adapter",
      channel,
      configSchema: {
        type:       "object",
        required:   ["api_key"],
        properties: {
          api_key:     { type: "string" },
          optional_n:  { type: "number" },
        },
      },
      capabilities: ["text"],
    },
    createInstance(instanceId, _config, _callbacks): AdapterInstance {
      return makeInstance(instanceId, channel);
    },
  };
}

function makeInstance(instanceId: string, channel = "test"): AdapterInstance {
  return {
    instanceId,
    channel,
    start:        vi.fn().mockResolvedValue(undefined),
    stop:         vi.fn().mockResolvedValue(undefined),
    sendResponse: vi.fn().mockResolvedValue(undefined),
    isHealthy:    vi.fn().mockReturnValue(true),
  };
}

function makeCallbacks(): AdapterCallbacks {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue("secret-value"),
    logger:    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
  };
}

function makeConfig(id = "inst-1", adapter = "test-adapter"): AdapterInstanceConfig {
  return {
    id,
    adapter,
    enabled:            true,
    config:             { api_key: "my-key" },
    rate_limit_per_min: 10,
  };
}

/** Build a PluginLoader that returns a known plugin for a given path suffix. */
function makeLoader(plugins: Record<string, MessagingAdapterPlugin>): PluginLoader {
  return async (path: string) => {
    for (const [key, plugin] of Object.entries(plugins)) {
      if (path.includes(key)) return plugin;
    }
    throw new Error(`No mock plugin for: ${path}`);
  };
}

// ---------------------------------------------------------------------------
// Fixtures — mock a directory with [telegram, discord, _template]
// ---------------------------------------------------------------------------

function setupMockFs(entries = ["telegram", "discord", "_template"]): void {
  mockExistsSync.mockImplementation((p: unknown) => {
    const path = String(p);
    // adapter dir exists; individual index.js files exist (not _template)
    if (path.endsWith("adapters/messaging") || entries.some((e) => path.includes(e))) {
      return true;
    }
    return false;
  });

  mockReaddirSync.mockReturnValue(entries as never);

  mockStatSync.mockImplementation((p: unknown) => {
    const path = String(p);
    // Mark everything as a directory
    return { isDirectory: () => !path.endsWith(".js") && !path.endsWith(".ts") } as ReturnType<typeof statSync>;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdapterRegistry — discoverAdapters()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when adapter directory does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const registry = new AdapterRegistry("adapters/messaging", undefined as never);
    const result   = await registry.discoverAdapters();
    expect(result).toEqual([]);
  });

  it("discovers adapters in directory", async () => {
    setupMockFs(["telegram", "discord"]);
    const loader = makeLoader({
      telegram: makePlugin("telegram", "telegram"),
      discord:  makePlugin("discord",  "discord"),
    });
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, loader);
    const result   = await registry.discoverAdapters();
    expect(result).toContain("telegram");
    expect(result).toContain("discord");
  });

  it("skips _template directory", async () => {
    setupMockFs(["telegram", "_template"]);
    const loader = makeLoader({ telegram: makePlugin("telegram", "telegram") });
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, loader);
    const result   = await registry.discoverAdapters();
    expect(result).not.toContain("_template");
    expect(result).toContain("telegram");
  });

  it("skips entries without index.js or index.ts", async () => {
    setupMockFs(["no-index-dir"]);
    // existsSync returns false for the index files inside this dir
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith("adapters/messaging")) return true;
      if (path.includes("no-index-dir") && (path.endsWith("index.js") || path.endsWith("index.ts"))) return false;
      if (path.includes("no-index-dir")) return true;
      return false;
    });
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, makeLoader({}));
    const result   = await registry.discoverAdapters();
    expect(result).toEqual([]);
  });

  it("skips adapters with invalid shape (no meta)", async () => {
    setupMockFs(["bad-adapter"]);
    const loader: PluginLoader = async () => ({ createInstance: vi.fn() } as unknown as MessagingAdapterPlugin);
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, loader);
    const result   = await registry.discoverAdapters();
    expect(result).toEqual([]);
  });

  it("skips adapters with missing createInstance", async () => {
    setupMockFs(["bad2"]);
    const loader: PluginLoader = async () => ({
      meta: { name: "bad2", channel: "bad", version: "1.0.0", description: "", configSchema: {}, capabilities: [] },
    } as unknown as MessagingAdapterPlugin);
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, loader);
    const result   = await registry.discoverAdapters();
    expect(result).toEqual([]);
  });
});

describe("AdapterRegistry — getAvailableAdapters()", () => {
  it("returns metadata of all loaded adapters", async () => {
    setupMockFs(["telegram"]);
    const plugin   = makePlugin("telegram", "telegram");
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, makeLoader({ telegram: plugin }));
    await registry.discoverAdapters();
    const metas = registry.getAvailableAdapters();
    expect(metas).toHaveLength(1);
    expect(metas[0]!.name).toBe("telegram");
    expect(metas[0]!.channel).toBe("telegram");
  });
});

describe("AdapterRegistry — createInstance()", () => {
  async function buildRegistryWithPlugin(plugin: MessagingAdapterPlugin): Promise<AdapterRegistry> {
    setupMockFs(["test-adapter"]);
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, makeLoader({ "test-adapter": plugin }));
    await registry.discoverAdapters();
    return registry;
  }

  it("creates an instance for a known adapter", async () => {
    const plugin   = makePlugin();
    const registry = await buildRegistryWithPlugin(plugin);
    const inst     = await registry.createInstance(makeConfig(), {
      onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
    });
    expect(inst.instanceId).toBe("inst-1");
  });

  it("throws for unknown adapter name", async () => {
    setupMockFs([]);
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, makeLoader({}));
    await registry.discoverAdapters();
    await expect(
      registry.createInstance(makeConfig("x", "unknown-adapter"), {
        onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
      }),
    ).rejects.toThrow("Unknown adapter");
  });

  it("rejects config that fails JSON Schema validation (missing required field)", async () => {
    const plugin   = makePlugin();
    const registry = await buildRegistryWithPlugin(plugin);
    const cfg      = { ...makeConfig(), config: {} }; // missing api_key
    await expect(
      registry.createInstance(cfg, {
        onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
      }),
    ).rejects.toThrow("Config validation failed");
  });

  it("rejects config with wrong type (number instead of string)", async () => {
    const plugin   = makePlugin();
    const registry = await buildRegistryWithPlugin(plugin);
    const cfg      = { ...makeConfig(), config: { api_key: 123 } }; // number, not string
    await expect(
      registry.createInstance(cfg, {
        onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
      }),
    ).rejects.toThrow("Config validation failed");
  });

  it("two instances of same adapter are independent", async () => {
    const plugin   = makePlugin();
    const registry = await buildRegistryWithPlugin(plugin);
    const cb       = { onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never };
    const a        = await registry.createInstance(makeConfig("inst-a"), cb);
    const b        = await registry.createInstance(makeConfig("inst-b"), cb);
    expect(a.instanceId).toBe("inst-a");
    expect(b.instanceId).toBe("inst-b");
    expect(a).not.toBe(b);
  });
});

describe("AdapterRegistry — start/stop/remove instance", () => {
  async function buildRegistry(): Promise<AdapterRegistry> {
    setupMockFs(["test-adapter"]);
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, makeLoader({ "test-adapter": makePlugin() }));
    await registry.discoverAdapters();
    return registry;
  }

  it("startInstance starts the adapter", async () => {
    const registry = await buildRegistry();
    const cb       = { onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never };
    await registry.createInstance(makeConfig(), cb);
    await expect(registry.startInstance("inst-1")).resolves.toBeUndefined();
  });

  it("startInstance throws for unknown instance", async () => {
    const registry = await buildRegistry();
    await expect(registry.startInstance("missing")).rejects.toThrow();
  });

  it("stopInstance stops the adapter (no-op for unknown)", async () => {
    const registry = await buildRegistry();
    await expect(registry.stopInstance("does-not-exist")).resolves.toBeUndefined();
  });

  it("removeInstance stops and deletes", async () => {
    const registry = await buildRegistry();
    const cb       = { onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never };
    await registry.createInstance(makeConfig(), cb);
    await registry.removeInstance("inst-1");
    expect(registry.getInstance("inst-1")).toBeUndefined();
  });

  it("getInstance returns instance by ID", async () => {
    const registry = await buildRegistry();
    const cb       = { onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never };
    await registry.createInstance(makeConfig(), cb);
    const inst = registry.getInstance("inst-1");
    expect(inst).toBeDefined();
    expect(inst!.instanceId).toBe("inst-1");
  });

  it("getAllInstances returns status of all instances", async () => {
    const registry = await buildRegistry();
    const cb       = { onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never };
    await registry.createInstance(makeConfig("a"), cb);
    await registry.createInstance(makeConfig("b"), cb);
    const all = registry.getAllInstances();
    expect(all).toHaveLength(2);
    expect(all.map((i) => i.instanceId)).toContain("a");
    expect(all.map((i) => i.instanceId)).toContain("b");
  });
});

describe("AdapterRegistry — startAll / stopAll", () => {
  it("startAll starts only enabled instances", async () => {
    setupMockFs(["test-adapter"]);
    const startSpy = vi.fn().mockResolvedValue(undefined);
    const pluginWithSpy = makePlugin();
    pluginWithSpy.createInstance = (_id, _cfg, _cb) => ({
      ...makeInstance(_id),
      start: startSpy,
    });
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, makeLoader({ "test-adapter": pluginWithSpy }));
    await registry.discoverAdapters();

    const configs: AdapterInstanceConfig[] = [
      { ...makeConfig("a"), enabled: true },
      { ...makeConfig("b"), enabled: false },
    ];
    await registry.startAll(configs);
    expect(startSpy).toHaveBeenCalledTimes(1); // only "a"
    expect(registry.getInstance("a")).toBeDefined();
    expect(registry.getInstance("b")).toBeUndefined();
  });

  it("stopAll stops all running instances", async () => {
    setupMockFs(["test-adapter"]);
    const stopSpy = vi.fn().mockResolvedValue(undefined);
    const pluginWithSpy = makePlugin();
    pluginWithSpy.createInstance = (_id, _cfg, _cb) => ({
      ...makeInstance(_id),
      stop: stopSpy,
    });
    const registry = new AdapterRegistry("adapters/messaging", undefined as never, makeLoader({ "test-adapter": pluginWithSpy }));
    await registry.discoverAdapters();
    const cb = { onMessage: vi.fn(), getSecret: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never };
    await registry.createInstance(makeConfig("a"), cb);
    await registry.createInstance(makeConfig("b"), cb);
    await registry.stopAll();
    expect(stopSpy).toHaveBeenCalledTimes(2);
    expect(registry.getAllInstances()).toHaveLength(0);
  });
});
