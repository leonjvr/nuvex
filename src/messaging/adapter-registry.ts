// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: AdapterRegistry
 *
 * Discovers, loads, validates, and manages messaging adapter plugins.
 *
 * Discovery is filesystem-based: scans adapterDir for subdirectories,
 * loads each as a MessagingAdapterPlugin, validates the shape, and
 * stores for later instantiation.
 *
 * Multi-instance: the same adapter plugin can back many independent
 * instances (e.g. two Telegram bots with different tokens).
 *
 * Hot add/remove: instances can be created, started, stopped, and
 * removed at runtime without restarting the orchestrator.
 */

import { readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  MessagingAdapterPlugin,
  AdapterMeta,
  AdapterInstance,
  AdapterCallbacks,
} from "./adapter-plugin.js";
import type { AdapterInstanceConfig } from "./types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("adapter-registry");

// ---------------------------------------------------------------------------
// Minimal JSON Schema validator (subset of draft-07)
// Supports: type, required, properties — sufficient for adapter configs.
// ---------------------------------------------------------------------------

type SchemaNode = {
  type?:       string;
  required?:   string[];
  properties?: Record<string, SchemaNode>;
};

function validateSchema(
  data:   Record<string, unknown>,
  schema: object,
  path    = "",
): string[] {
  const errors: string[] = [];
  const s = schema as SchemaNode;

  if (s.required !== undefined) {
    for (const key of s.required) {
      if (!(key in data)) {
        errors.push(`${path ? path + "." : ""}${key} is required`);
      }
    }
  }

  if (s.properties !== undefined) {
    for (const [key, propSchema] of Object.entries(s.properties)) {
      if (!(key in data)) continue;
      const val      = data[key];
      const propPath = path ? `${path}.${key}` : key;

      if (propSchema.type !== undefined) {
        const jsType = Array.isArray(val) ? "array" : typeof val;
        const expectedType = propSchema.type === "integer" ? "number" : propSchema.type;
        if (jsType !== expectedType) {
          errors.push(
            `${propPath} must be of type ${propSchema.type}, got ${jsType}`,
          );
        }
      }

      if (propSchema.type === "object" && val !== null && typeof val === "object") {
        errors.push(
          ...validateSchema(val as Record<string, unknown>, propSchema, propPath),
        );
      }
    }
  }

  return errors;
}


export type PluginLoader = (modulePath: string) => Promise<MessagingAdapterPlugin>;

async function defaultPluginLoader(modulePath: string): Promise<MessagingAdapterPlugin> {
  // Use file URL for ESM compatibility
  const fileUrl = pathToFileURL(modulePath).href;
  const mod     = await import(fileUrl) as { default?: MessagingAdapterPlugin } | MessagingAdapterPlugin;
  const plugin  = "default" in mod ? mod.default : mod;
  if (plugin === undefined || plugin === null) {
    throw new Error(`Adapter module has no default export: ${modulePath}`);
  }
  return plugin as MessagingAdapterPlugin;
}


export class AdapterRegistry {
  /** Loaded adapter plugins, keyed by adapter name (e.g. "telegram"). */
  private readonly plugins   = new Map<string, MessagingAdapterPlugin>();
  /** Running adapter instances, keyed by instance ID. */
  private readonly instances = new Map<string, AdapterInstance>();

  constructor(
    /** Filesystem path to the adapter directory, e.g. "adapters/messaging". */
    private readonly adapterDir:  string,
    /** Optional secret getter used when building AdapterCallbacks. */
    private readonly getSecretFn: (key: string) => Promise<string> = async () => {
      throw new Error("No secrets manager configured");
    },
    /** Overrideable plugin loader for testing. */
    private readonly loadPlugin:  PluginLoader = defaultPluginLoader,
  ) {}

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /**
   * Scan adapterDir for subdirectories containing index.js/index.ts,
   * load each as a MessagingAdapterPlugin, and register it.
   *
   * Skips `_template` and any entry that is not a directory.
   * Logs a warning for invalid adapters but does not throw.
   *
   * @returns Names of successfully loaded adapters.
   */
  async discoverAdapters(): Promise<string[]> {
    const absDir = resolve(this.adapterDir);

    if (!existsSync(absDir)) {
      logger.warn("adapter-registry", "Adapter directory does not exist", {
        metadata: { dir: absDir },
      });
      return [];
    }

    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch (e: unknown) {
      logger.warn("adapter-registry", "Failed to read adapter directory", {
        metadata: { dir: absDir, error: e instanceof Error ? e.message : String(e) },
      });
      return [];
    }

    const loaded: string[] = [];

    for (const entry of entries) {
      if (entry === "_template") continue; // skip template directory

      const entryPath = join(absDir, entry);
      try {
        if (!statSync(entryPath).isDirectory()) continue;
      } catch (e: unknown) {
        void e; // cleanup-ignore: statSync failure on filesystem race is best-effort
        continue;
      }

      // Prefer compiled .js, fall back to .ts (when running via ts-node / vitest)
      const jsPath  = join(entryPath, "index.js");
      const tsPath  = join(entryPath, "index.ts");
      const modPath = existsSync(jsPath) ? jsPath : existsSync(tsPath) ? tsPath : null;

      if (modPath === null) {
        logger.warn("adapter-registry", "Adapter directory has no index.js/ts — skipping", {
          metadata: { adapter: entry },
        });
        continue;
      }

      try {
        const plugin = await this.loadPlugin(modPath);
        this._validatePluginShape(plugin, entry);
        this.plugins.set(entry, plugin);
        logger.info("adapter-registry", "Adapter loaded", {
          metadata: {
            event:   "ADAPTER_LOADED" as const,
            adapter: entry,
            channel: plugin.meta.channel,
          },
        });
        loaded.push(entry);
      } catch (e: unknown) {
        logger.warn("adapter-registry", "Failed to load adapter", {
          metadata: {
            adapter: entry,
            error:   e instanceof Error ? e.message : String(e),
          },
        });
      }
    }

    return loaded;
  }

  /** Return metadata of all successfully loaded adapter plugins. */
  getAvailableAdapters(): AdapterMeta[] {
    return Array.from(this.plugins.values()).map((p) => p.meta);
  }

  // ---------------------------------------------------------------------------
  // Instance management
  // ---------------------------------------------------------------------------

  /**
   * Create (but do not start) a new adapter instance from a config block.
   * Validates config against the adapter's JSON Schema before instantiation.
   */
  async createInstance(
    config:    AdapterInstanceConfig,
    callbacks: AdapterCallbacks,
  ): Promise<AdapterInstance> {
    const plugin = this.plugins.get(config.adapter);
    if (plugin === undefined) {
      throw new Error(`Unknown adapter '${config.adapter}'. Available: ${[...this.plugins.keys()].join(", ") || "none"}`);
    }

    // Validate config against adapter's JSON Schema
    const errors = validateSchema(config.config, plugin.meta.configSchema);
    if (errors.length > 0) {
      throw new Error(`Config validation failed for adapter '${config.adapter}': ${errors.join("; ")}`);
    }

    const instance = plugin.createInstance(config.id, config.config, callbacks);
    this.instances.set(config.id, instance);
    return instance;
  }

  /** Start a previously created adapter instance. */
  async startInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (instance === undefined) {
      throw new Error(`Instance '${instanceId}' not found`);
    }
    try {
      await instance.start();
      logger.info("adapter-registry", "Instance started", {
        metadata: { event: "INSTANCE_STARTED" as const, instance_id: instanceId },
      });
    } catch (e: unknown) {
      logger.warn("adapter-registry", "Instance failed to start", {
        metadata: {
          event:       "INSTANCE_ERROR" as const,
          instance_id: instanceId,
          error:       e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }
  }

  /** Stop a running adapter instance. */
  async stopInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (instance === undefined) return;
    try {
      await instance.stop();
    } catch (e: unknown) {
      logger.warn("adapter-registry", "Instance stop error (ignoring)", {
        metadata: {
          event:       "INSTANCE_ERROR" as const,
          instance_id: instanceId,
          error:       e instanceof Error ? e.message : String(e),
        },
      });
    }
    logger.info("adapter-registry", "Instance stopped", {
      metadata: { event: "INSTANCE_STOPPED" as const, instance_id: instanceId },
    });
  }

  /**
   * Stop and remove an adapter instance from the registry.
   * After this call the instance is gone and must be re-created to run again.
   */
  async removeInstance(instanceId: string): Promise<void> {
    await this.stopInstance(instanceId);
    this.instances.delete(instanceId);
    logger.info("adapter-registry", "Instance removed", {
      metadata: { event: "ADAPTER_UNLOADED" as const, instance_id: instanceId },
    });
  }

  /** Return a running instance by ID, or undefined if not found. */
  getInstance(instanceId: string): AdapterInstance | undefined {
    return this.instances.get(instanceId);
  }

  /** Return status of all instances. */
  getAllInstances(): { instanceId: string; channel: string; healthy: boolean }[] {
    return Array.from(this.instances.entries()).map(([id, inst]) => ({
      instanceId: id,
      channel:    inst.channel,
      healthy:    inst.isHealthy(),
    }));
  }

  /**
   * Create and start all enabled instances from a config list.
   * Individual instance failures are logged but do not abort the rest.
   */
  async startAll(
    configs:    AdapterInstanceConfig[],
    callbacks?: Partial<AdapterCallbacks>,
  ): Promise<void> {
    for (const cfg of configs) {
      if (!cfg.enabled) continue;

      const cb: AdapterCallbacks = {
        onMessage:  callbacks?.onMessage  ?? (async () => undefined),
        getSecret:  callbacks?.getSecret  ?? this.getSecretFn,
        logger:     callbacks?.logger     ?? createLogger(`adapter:${cfg.id}`),
      };

      try {
        await this.createInstance(cfg, cb);
        await this.startInstance(cfg.id);
      } catch (e: unknown) {
        logger.warn("adapter-registry", "Failed to start instance — continuing", {
          metadata: {
            instance_id: cfg.id,
            adapter:     cfg.adapter,
            error:       e instanceof Error ? e.message : String(e),
          },
        });
      }
    }
  }

  /** Stop all running instances. */
  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.instances.keys()).map((id) => this.stopInstance(id)),
    );
    this.instances.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _validatePluginShape(plugin: unknown, name: string): void {
    if (plugin === null || typeof plugin !== "object") {
      throw new Error(`Adapter '${name}' did not export an object`);
    }
    const p = plugin as Record<string, unknown>;
    if (typeof p["meta"] !== "object" || p["meta"] === null) {
      throw new Error(`Adapter '${name}' is missing 'meta'`);
    }
    if (typeof p["createInstance"] !== "function") {
      throw new Error(`Adapter '${name}' is missing 'createInstance'`);
    }
    const meta = p["meta"] as Record<string, unknown>;
    if (typeof meta["name"] !== "string" || typeof meta["channel"] !== "string") {
      throw new Error(`Adapter '${name}' meta is missing 'name' or 'channel'`);
    }
  }
}
