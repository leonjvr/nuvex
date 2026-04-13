// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Adapter Loader
 *
 * Scans a directory for `*.yaml` / `*.yml` adapter definition files, performs
 * environment-variable substitution (`${VAR}` → `process.env.VAR`), and
 * registers valid definitions with the provided `AdapterRegistry`.
 *
 * Environment variable substitution is performed on the raw YAML string
 * BEFORE parsing so that all string fields (base_url, secret_ref, etc.)
 * can reference env vars.
 *
 * Missing env vars are substituted with an empty string and a warning is
 * logged — we do not throw, because an adapter might be intentionally
 * disabled or configured at runtime.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync }        from "node:fs";
import { join }              from "node:path";
import { parse as parseYaml } from "yaml";
import { createLogger }      from "../../core/logger.js";
import type { AdapterRegistry } from "../adapter-registry.js";

const logger = createLogger("adapter-loader");


/**
 * Replace all `${VAR_NAME}` placeholders in `text` with the value of
 * `process.env.VAR_NAME`.  Unknown variables are replaced with `""` and
 * logged as warnings.
 */
export function substituteEnvVars(text: string): string {
  return text.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      logger.warn("adapter-loader", `Environment variable '${varName}' is not set — substituting empty string`, {
        metadata: { variable: varName },
      });
      return "";
    }
    return value;
  });
}


/**
 * Load all `*.yaml` / `*.yml` adapter definitions from `directory`, perform
 * env-var substitution, and register them with `registry`.
 *
 * - Disabled adapters (`enabled: false`) are registered but skipped silently
 *   (the registry tracks them; the route-resolver filters them).
 * - Files that fail YAML parse or validation are logged and skipped.
 *
 * @param directory  Directory that directly contains `*.yaml` files.
 *                   (This is the integrations directory itself, not its parent.)
 * @param registry   AdapterRegistry to register definitions into.
 * @returns          Number of successfully registered adapters.
 */
export async function loadAdapters(
  directory: string,
  registry: AdapterRegistry,
): Promise<number> {
  if (!existsSync(directory)) {
    logger.debug("adapter-loader", "Integrations directory does not exist — skipping", {
      metadata: { path: directory },
    });
    return 0;
  }

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (e: unknown) {
    logger.warn("adapter-loader", "Could not read integrations directory", {
      metadata: { path: directory, error: e instanceof Error ? e.message : String(e) },
    });
    return 0;
  }

  let loaded = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;

    const filePath = join(directory, entry);
    try {
      const raw = await readFile(filePath, "utf-8");
      const substituted = substituteEnvVars(raw);
      const parsed: unknown = parseYaml(substituted);
      registry.registerAdapter(parsed, filePath);
      loaded++;
      logger.debug("adapter-loader", `Loaded adapter from '${entry}'`, {
        metadata: { file: filePath },
      });
    } catch (e: unknown) {
      logger.warn("adapter-loader", `Failed to load adapter from '${entry}' — skipping`, {
        metadata: { file: filePath, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  logger.debug("adapter-loader", `Loaded ${loaded} adapter(s) from directory`, {
    metadata: { path: directory, total: loaded },
  });
  return loaded;
}
