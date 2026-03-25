// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/update/update-check.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import {
  readCheckCache,
  writeCheckCache,
  isCacheStale,
  getUpdateNotifications,
  shouldSkipCheck,
  type UpdateCheckCache,
} from "../../../src/core/update/update-check.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-upcheck-test-"));
}

describe("readCheckCache / writeCheckCache", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("readCheckCache returns null when file does not exist", () => {
    expect(readCheckCache(tmp)).toBeNull();
  });

  it("writeCheckCache creates readable cache file", () => {
    const cache: UpdateCheckCache = {
      lastCheck: new Date().toISOString(),
      latestVersion: "0.11.0",
      latestRulesetVersion: "1.1",
      currentVersion: "0.10.0",
    };
    writeCheckCache(tmp, cache);
    const loaded = readCheckCache(tmp);
    expect(loaded).not.toBeNull();
    expect(loaded!.latestVersion).toBe("0.11.0");
    expect(loaded!.latestRulesetVersion).toBe("1.1");
  });

  it("readCheckCache returns null for malformed JSON", () => {
    writeFileSync(join(tmp, ".update-check-cache.json"), "{{{invalid");
    const cache = readCheckCache(tmp);
    expect(cache).toBeNull();
  });
});

describe("isCacheStale", () => {
  it("returns true for cache older than 24 hours", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const cache: UpdateCheckCache = {
      lastCheck: old,
      latestVersion: "0.10.0",
      latestRulesetVersion: "1.0",
      currentVersion: "0.10.0",
    };
    expect(isCacheStale(cache)).toBe(true);
  });

  it("returns false for fresh cache (< 24h)", () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const cache: UpdateCheckCache = {
      lastCheck: recent,
      latestVersion: "0.10.0",
      latestRulesetVersion: "1.0",
      currentVersion: "0.10.0",
    };
    expect(isCacheStale(cache)).toBe(false);
  });
});

describe("getUpdateNotifications", () => {
  const baseCache: UpdateCheckCache = {
    lastCheck: new Date().toISOString(),
    latestVersion: "0.10.0",
    latestRulesetVersion: "1.0",
    currentVersion: "0.10.0",
  };

  it("returns empty array when up to date", () => {
    const notifications = getUpdateNotifications(baseCache, "0.10.0", "1.0");
    expect(notifications).toHaveLength(0);
  });

  it("returns product update notification when newer version available", () => {
    const cache = { ...baseCache, latestVersion: "0.11.0" };
    const notifications = getUpdateNotifications(cache, "0.10.0", "1.0");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("product");
    expect(notifications[0]!.message).toContain("0.11.0");
    expect(notifications[0]!.message).toContain("sidjua update");
  });

  it("returns governance notification when newer ruleset available", () => {
    const cache = { ...baseCache, latestRulesetVersion: "1.1" };
    const notifications = getUpdateNotifications(cache, "0.10.0", "1.0");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("governance");
    expect(notifications[0]!.message).toContain("1.1");
    expect(notifications[0]!.message).toContain("--governance");
  });

  it("returns both notifications when both are outdated", () => {
    const cache = { ...baseCache, latestVersion: "0.11.0", latestRulesetVersion: "1.1" };
    const notifications = getUpdateNotifications(cache, "0.10.0", "1.0");
    expect(notifications).toHaveLength(2);
  });

  it("does not notify when cache version is OLDER than current (no downgrade notification)", () => {
    const cache = { ...baseCache, latestVersion: "0.9.0" };
    const notifications = getUpdateNotifications(cache, "0.10.0", "1.0");
    expect(notifications).toHaveLength(0);
  });
});

describe("shouldSkipCheck", () => {
  beforeEach(() => {
    delete process.env["SIDJUA_NO_UPDATE_CHECK"];
  });

  afterEach(() => {
    delete process.env["SIDJUA_NO_UPDATE_CHECK"];
  });

  it("returns true when SIDJUA_NO_UPDATE_CHECK=1", () => {
    process.env["SIDJUA_NO_UPDATE_CHECK"] = "1";
    expect(shouldSkipCheck(["node", "sidjua", "rules"])).toBe(true);
  });

  it("returns true when --no-update-check flag present", () => {
    expect(shouldSkipCheck(["node", "sidjua", "--no-update-check", "rules"])).toBe(true);
  });

  it("returns true when running update command (avoid recursive check)", () => {
    expect(shouldSkipCheck(["node", "sidjua", "update"])).toBe(true);
  });

  it("returns true when running rollback command", () => {
    expect(shouldSkipCheck(["node", "sidjua", "rollback"])).toBe(true);
  });

  it("returns false for normal commands", () => {
    expect(shouldSkipCheck(["node", "sidjua", "rules"])).toBe(false);
    expect(shouldSkipCheck(["node", "sidjua", "version"])).toBe(false);
  });
});
