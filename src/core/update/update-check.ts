// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Passive Version Check Notification
 *
 * Runs a background version check on every CLI invocation.
 * Reads from a cache file to avoid network calls on every run.
 * Cache is refreshed asynchronously — never blocks CLI startup.
 *
 * Cache location: <dataDir>/.update-check-cache.json
 * Cache TTL: 24 hours (configurable via SIDJUA_UPDATE_CHECK_INTERVAL_HOURS)
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import type { UpdateProvider } from "./update-provider.js";
import { createLogger } from "../logger.js";

// ---------------------------------------------------------------------------
// Types
const logger = createLogger("update-check");

// ---------------------------------------------------------------------------

export interface UpdateCheckCache {
  lastCheck:            string;   // ISO timestamp
  latestVersion:        string | null;
  latestRulesetVersion: string | null;
  currentVersion:       string;
}

export interface UpdateNotification {
  type:    "product" | "governance";
  message: string;
}


const CACHE_FILE         = ".update-check-cache.json";
const DEFAULT_TTL_HOURS  = 24;


export function readCheckCache(dataDir: string): UpdateCheckCache | null {
  const cachePath = join(dataDir, CACHE_FILE);
  if (!existsSync(cachePath)) return null;

  try {
    const raw = readFileSync(cachePath, "utf-8");
    return JSON.parse(raw) as UpdateCheckCache;
  } catch (e: unknown) {
    logger.debug("update-check", "Update cache read failed — treating as absent", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return null;
  }
}


export function writeCheckCache(dataDir: string, cache: UpdateCheckCache): void {
  const cachePath = join(dataDir, CACHE_FILE);
  const dir = dirname(cachePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  try {
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  } catch (e: unknown) {
    logger.warn("update-check", "Update cache write failed — non-fatal", { metadata: { error: e instanceof Error ? e.message : String(e), cachePath } });
  }
}


export function isCacheStale(cache: UpdateCheckCache): boolean {
  const ttlHours = Number(process.env["SIDJUA_UPDATE_CHECK_INTERVAL_HOURS"] ?? DEFAULT_TTL_HOURS);
  const ttlMs    = ttlHours * 60 * 60 * 1000;
  const age      = Date.now() - new Date(cache.lastCheck).getTime();
  return age > ttlMs;
}


/**
 * Returns notifications to display based on cached update info.
 * Returns empty array if up-to-date or cache is absent.
 */
export function getUpdateNotifications(
  cache:          UpdateCheckCache,
  currentVersion: string,
  currentRuleset: string,
): UpdateNotification[] {
  const notifications: UpdateNotification[] = [];

  if (
    cache.latestVersion !== null &&
    cache.latestVersion !== currentVersion &&
    semverGt(cache.latestVersion, currentVersion)
  ) {
    notifications.push({
      type:    "product",
      message: `SIDJUA v${cache.latestVersion} available (you have v${currentVersion}) — Run: sidjua update`,
    });
  }

  if (
    cache.latestRulesetVersion !== null &&
    cache.latestRulesetVersion !== currentRuleset &&
    semverGt(cache.latestRulesetVersion, currentRuleset)
  ) {
    notifications.push({
      type:    "governance",
      message: `Security Update: Governance Ruleset ${cache.latestRulesetVersion} available — Run: sidjua update --governance`,
    });
  }

  return notifications;
}


/**
 * Spawn an async update check that does NOT block the CLI.
 * Result is written to cache for next invocation.
 */
export function runBackgroundCheck(
  dataDir:        string,
  provider:       UpdateProvider,
  currentVersion: string,
  currentRuleset: string,
): void {
  // Intentionally not awaited — fire and forget
  void (async () => {
    try {
      const [updateInfo, govInfo] = await Promise.all([
        provider.checkForUpdate(currentVersion).catch(() => null),
        provider.checkForGovernanceUpdate(currentRuleset).catch(() => null),
      ]);

      const cache: UpdateCheckCache = {
        lastCheck:            new Date().toISOString(),
        latestVersion:        updateInfo?.version ?? currentVersion,
        latestRulesetVersion: govInfo?.rulesetVersion ?? currentRuleset,
        currentVersion,
      };

      writeCheckCache(dataDir, cache);
    } catch (e: unknown) {
      logger.warn("update-check", "Background update check failed — non-fatal", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }
  })();
}


/**
 * Returns true if the update check should be skipped based on env/flags.
 */
export function shouldSkipCheck(argv: string[]): boolean {
  if (process.env["SIDJUA_NO_UPDATE_CHECK"] === "1") return true;
  if (argv.includes("--no-update-check")) return true;
  // Skip check during update/rollback operations themselves
  const skipCommands = ["update", "rollback"];
  const subcommand   = argv[2];
  if (subcommand !== undefined && skipCommands.includes(subcommand)) return true;
  return false;
}


/**
 * Main entry point — call this at CLI startup before program.parse().
 * Reads cache, displays notifications if any, and refreshes cache if stale.
 * Never throws or blocks.
 */
export function performStartupCheck(
  dataDir:        string,
  provider:       UpdateProvider,
  currentVersion: string,
  currentRuleset: string,
  argv:           string[],
): void {
  if (shouldSkipCheck(argv)) return;

  try {
    const cache = readCheckCache(dataDir);

    if (cache !== null) {
      // Display cached notifications
      const notifications = getUpdateNotifications(cache, currentVersion, currentRuleset);
      for (const n of notifications) {
        process.stderr.write(`\n[SIDJUA] ${n.message}\n`);
      }

      // Refresh cache in background if stale
      if (isCacheStale(cache)) {
        runBackgroundCheck(dataDir, provider, currentVersion, currentRuleset);
      }
    } else {
      // No cache at all — kick off background check
      runBackgroundCheck(dataDir, provider, currentVersion, currentRuleset);
    }
  } catch (e: unknown) {
    logger.warn("update-check", "Startup update check failed — suppressed to avoid blocking CLI", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }
}


function semverGt(a: string, b: string): boolean {
  const parse = (s: string): number[] =>
    s.split(".").map((p) => parseInt(p.replace(/[^0-9]/g, ""), 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}
