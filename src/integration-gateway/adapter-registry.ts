// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Adapter Registry
 *
 * Holds adapter definitions (loaded from governance/integrations/*.yaml
 * or registered programmatically).  Validates definitions on registration.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync }        from "node:fs";
import { join }              from "node:path";
import { parse as parseYaml } from "yaml";
import { SidjuaError }       from "../core/error-codes.js";
import { createLogger }      from "../core/logger.js";
import type { AdapterAuth, AdapterDefinition, ProtocolType } from "./types.js";

const logger = createLogger("adapter-registry");


const VALID_PROTOCOLS: ReadonlySet<string> = new Set<ProtocolType>([
  "rest", "graphql", "local_script", "cli", "mcp",
]);

const VALID_RISK_LEVELS: ReadonlySet<string> = new Set([
  "low", "medium", "high", "critical",
]);


function validateAdapterDefinition(def: unknown, source: string): AdapterDefinition {
  if (typeof def !== "object" || def === null) {
    throw SidjuaError.from("IGW-003", `${source}: adapter definition must be an object`);
  }

  const d = def as Record<string, unknown>;

  if (typeof d["name"] !== "string" || d["name"].trim() === "") {
    throw SidjuaError.from("IGW-003", `${source}: missing or empty 'name' field`);
  }
  if (!VALID_PROTOCOLS.has(String(d["protocol"]))) {
    throw SidjuaError.from(
      "IGW-010",
      `${source} '${String(d["name"])}': unknown protocol '${String(d["protocol"])}' — must be one of ${[...VALID_PROTOCOLS].join(", ")}`,
    );
  }
  if (typeof d["actions"] !== "object" || d["actions"] === null || Array.isArray(d["actions"])) {
    throw SidjuaError.from("IGW-003", `${source} '${String(d["name"])}': 'actions' must be a non-empty object`);
  }

  const actions = d["actions"] as Record<string, unknown>;
  if (Object.keys(actions).length === 0) {
    throw SidjuaError.from("IGW-003", `${source} '${String(d["name"])}': 'actions' must have at least one entry`);
  }

  for (const [actionName, actionDef] of Object.entries(actions)) {
    if (typeof actionDef !== "object" || actionDef === null) {
      throw SidjuaError.from("IGW-003", `${source} '${String(d["name"])}' action '${actionName}': must be an object`);
    }
    const a = actionDef as Record<string, unknown>;
    if (typeof a["governance"] !== "object" || a["governance"] === null) {
      throw SidjuaError.from(
        "IGW-003",
        `${source} '${String(d["name"])}' action '${actionName}': missing 'governance' block`,
      );
    }
    const gov = a["governance"] as Record<string, unknown>;
    if (typeof gov["budget_per_call"] !== "number") {
      throw SidjuaError.from(
        "IGW-003",
        `${source} '${String(d["name"])}' action '${actionName}': governance.budget_per_call must be a number`,
      );
    }
    if (!VALID_RISK_LEVELS.has(String(gov["risk_level"]))) {
      throw SidjuaError.from(
        "IGW-003",
        `${source} '${String(d["name"])}' action '${actionName}': governance.risk_level must be one of ${[...VALID_RISK_LEVELS].join(", ")}`,
      );
    }
    if (gov["require_approval"] === undefined) {
      throw SidjuaError.from(
        "IGW-003",
        `${source} '${String(d["name"])}' action '${actionName}': governance.require_approval is required`,
      );
    }
  }

  // Coerce to typed definition with defaults
  const result: AdapterDefinition = {
    name:     String(d["name"]).trim(),
    type:     (d["type"] === "intelligent" ? "intelligent" : "deterministic"),
    protocol: d["protocol"] as ProtocolType,
    enabled:  d["enabled"] !== false, // default true
    actions:  actions as AdapterDefinition["actions"],
  };
  if (typeof d["base_url"]    === "string") result.base_url    = d["base_url"];
  if (typeof d["script_path"] === "string") result.script_path = d["script_path"];
  if (typeof d["runtime"]     === "string") result.runtime     = d["runtime"];
  if (typeof d["auth"] === "object" && d["auth"] !== null) {
    result.auth = d["auth"] as AdapterAuth;
  }
  return result;
}


export class AdapterRegistry {
  private readonly registry = new Map<string, AdapterDefinition>();

  /**
   * Register an adapter definition, validating it first.
   * Throws `SidjuaError` with IGW-003 or IGW-010 on invalid definitions.
   * Disabled adapters are still registered (use `hasAdapter` to check `enabled`).
   */
  registerAdapter(def: unknown, source = "programmatic"): void {
    const validated = validateAdapterDefinition(def, source);
    if (this.registry.has(validated.name)) {
      logger.warn("adapter-registry", `Overwriting existing adapter '${validated.name}'`, {
        metadata: { source },
      });
    }
    this.registry.set(validated.name, validated);
    logger.debug("adapter-registry", `Registered adapter '${validated.name}'`, {
      metadata: { source, protocol: validated.protocol, enabled: validated.enabled },
    });
  }

  /**
   * Return an adapter by service name, or `undefined` if not found.
   * Returns adapters regardless of `enabled` status — caller must check.
   */
  getAdapter(service: string): AdapterDefinition | undefined {
    return this.registry.get(service);
  }

  /**
   * Whether an **enabled** adapter with this service name is registered.
   */
  hasAdapter(service: string): boolean {
    const def = this.registry.get(service);
    return def !== undefined && def.enabled;
  }

  /**
   * Return all registered adapters (including disabled ones).
   */
  listAdapters(): AdapterDefinition[] {
    return [...this.registry.values()];
  }

  /**
   * Load all `*.yaml` files from `<dir>/governance/integrations/` as adapters.
   * Files that fail validation are logged and skipped — not thrown.
   */
  async loadFromDirectory(dir: string): Promise<number> {
    const integrationsDir = join(dir, "governance", "integrations");
    if (!existsSync(integrationsDir)) {
      logger.debug("adapter-registry", "No integrations directory found — skipping auto-load", {
        metadata: { path: integrationsDir },
      });
      return 0;
    }

    let loaded = 0;
    let entries: string[];
    try {
      entries = await readdir(integrationsDir);
    } catch (e: unknown) {
      logger.warn("adapter-registry", "Could not read integrations directory", {
        metadata: { path: integrationsDir, error: e instanceof Error ? e.message : String(e) },
      });
      return 0;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
      const filePath = join(integrationsDir, entry);
      try {
        const raw = await readFile(filePath, "utf-8");
        const parsed: unknown = parseYaml(raw);
        this.registerAdapter(parsed, filePath);
        loaded++;
      } catch (e: unknown) {
        logger.warn("adapter-registry", `Failed to load adapter from '${entry}' — skipping`, {
          metadata: { file: filePath, error: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    logger.debug("adapter-registry", `Loaded ${loaded} adapter(s) from directory`, {
      metadata: { path: integrationsDir },
    });
    return loaded;
  }
}
