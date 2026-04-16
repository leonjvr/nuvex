// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Path Resolver
 *
 * Resolves logical paths to physical filesystem locations.
 *
 * Two ownership domains:
 *   system/ — SIDJUA-owned; replaced on update; always relative to the
 *              npm package installation directory
 *   data/   — User-owned; never touched by updates; location determined by:
 *              1. SIDJUA_DATA_DIR env var
 *              2. sidjua.config.json in cwd or any ancestor directory
 *              3. ~/.sidjua/ (default fallback)
 *
 * Usage:
 *   import { resolvePaths, getPaths } from './paths.js';
 *   const paths = getPaths();           // singleton (resolved once at startup)
 *   const paths = resolvePaths('/custom/data'); // explicit override
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname }   from "node:path";
import { homedir }                  from "node:os";
import { fileURLToPath }            from "node:url";
import { createLogger }             from "./logger.js";

const logger = createLogger("paths");


export interface SystemPaths {
  /** npm package root (contains system/VERSION) */
  root:       string;
  schemas:    string;
  governance: string;
  defaults:   string;
  providers:  string;
  migrations: string;
  templates:  string;
  /** path to system/VERSION file */
  version:    string;
}

export interface DataPaths {
  /** user data root */
  root:           string;
  config:         string;
  governance:     string;
  divisions:      string;
  secrets:        string;
  logs:           string;
  knowledge:      string;
  backups:        string;
  /** .migration-state.json */
  migrationState: string;
}

export interface SidjuaPaths {
  system: SystemPaths;
  data:   DataPaths;
}


/**
 * Walk upward from `startDir` looking for `sidjua.config.json`.
 * Returns the `dataDir` field from that file, or null if not found.
 *
 * Stops at the filesystem root or after 20 levels (circular-reference guard).
 */
export function findDataDir(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  let depth   = 0;

  while (depth < 20) {
    const configPath = join(current, "sidjua.config.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const cfg = JSON.parse(raw) as Record<string, unknown>;
        if (typeof cfg["dataDir"] === "string" && cfg["dataDir"].length > 0) {
          return resolve(dirname(configPath), cfg["dataDir"]);
        }
      } catch (e: unknown) {
        logger.debug("paths", "Config file parse failed — continuing search upward", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    const parent = dirname(current);
    if (parent === current) break; // filesystem root reached
    current = parent;
    depth++;
  }

  return null;
}


/**
 * Walk upward from `startFile` until we find a directory that contains
 * `system/VERSION`. This handles both development (src/core/paths.ts) and
 * bundled (dist/index.js) layouts without assuming a fixed nesting depth.
 */
function findSystemRoot(startFile: string): string {
  let current = dirname(startFile);
  let depth   = 0;
  while (depth < 10) {
    const candidate = join(current, "system");
    if (existsSync(join(candidate, "VERSION"))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
    depth++;
  }
  // Fallback: assume same layout as development (3 levels up from this file)
  return join(dirname(dirname(dirname(startFile))), "system");
}


/**
 * Resolve system and data paths.
 *
 * Priority for data dir:
 *   1. `dataDir` argument (explicit override)
 *   2. `SIDJUA_DATA_DIR` environment variable
 *   3. sidjua.config.json in cwd or ancestor
 *   4. ~/.sidjua/ (default)
 */
export function resolvePaths(dataDir?: string): SidjuaPaths {
  // System root: walk upward from this file until we find a directory
  // containing system/VERSION. Works both in development (src/core/paths.ts)
  // and when bundled into a single file (dist/index.js).
  const thisFile   = fileURLToPath(import.meta.url);
  const systemRoot = findSystemRoot(thisFile);

  // Data root resolution
  const dataRoot =
    dataDir                                   ??
    process.env["SIDJUA_DATA_DIR"]            ??
    findDataDir()                             ??
    join(homedir(), ".sidjua");

  return {
    system: {
      root:       systemRoot,
      schemas:    join(systemRoot, "schemas"),
      governance: join(systemRoot, "governance"),
      defaults:   join(systemRoot, "defaults"),
      providers:  join(systemRoot, "providers"),
      migrations: join(systemRoot, "migrations"),
      templates:  join(systemRoot, "templates"),
      version:    join(systemRoot, "VERSION"),
    },
    data: {
      root:           dataRoot,
      config:         join(dataRoot, "config"),
      governance:     join(dataRoot, "governance"),
      divisions:      join(dataRoot, "divisions"),
      secrets:        join(dataRoot, "secrets"),
      logs:           join(dataRoot, "logs"),
      knowledge:      join(dataRoot, "knowledge"),
      backups:        join(dataRoot, "backups"),
      migrationState: join(dataRoot, ".migration-state.json"),
    },
  };
}


/**
 * Validate that the resolved paths are usable.
 *
 * @throws Error if the system directory is missing or data dir cannot be inferred
 */
export function validatePaths(paths: SidjuaPaths): void {
  if (!existsSync(paths.system.root)) {
    throw new Error(
      `SIDJUA system directory not found at "${paths.system.root}". ` +
      "The npm package may be corrupted. Try reinstalling SIDJUA.",
    );
  }
  if (!existsSync(paths.system.version)) {
    throw new Error(
      `system/VERSION missing at "${paths.system.version}". ` +
      "The npm package may be corrupted. Try reinstalling SIDJUA.",
    );
  }
}


let _singleton: SidjuaPaths | null = null;

/**
 * Return the global singleton SidjuaPaths, resolved once on first call.
 * Subsequent calls return the cached instance.
 *
 * Use `resetPathsSingleton()` in tests to force re-resolution.
 */
export function getPaths(): SidjuaPaths {
  if (_singleton === null) {
    _singleton = resolvePaths();
  }
  return _singleton;
}

/**
 * Reset the singleton (for testing only).
 */
export function resetPathsSingleton(): void {
  _singleton = null;
}
