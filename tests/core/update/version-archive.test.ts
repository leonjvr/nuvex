// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/update/version-archive.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import { VersionArchiveManager } from "../../../src/core/update/version-archive.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-varchive-test-"));
}

function makeSystemDir(installDir: string): string {
  const sysDir = join(installDir, "system");
  mkdirSync(join(sysDir, "governance"), { recursive: true });
  writeFileSync(join(sysDir, "VERSION"), "0.10.0");
  writeFileSync(join(sysDir, "governance", "VERSION"), JSON.stringify({
    ruleset_version: "1.0",
    compatible_sidjua_min: "0.10.0",
    compatible_sidjua_max: "0.x.x",
    released: "2026-03-14T00:00:00Z",
    rules_count: 10,
    changelog: "test",
  }));
  writeFileSync(join(sysDir, "governance", "rules.yaml"), "rules:\n  - id: SYS-001\n");
  return sysDir;
}

describe("VersionArchiveManager", () => {
  let tmp:      string;
  let installDir: string;
  let sysDir:   string;
  let mgr:      VersionArchiveManager;

  beforeEach(() => {
    tmp        = makeTempDir();
    installDir = tmp;
    sysDir     = makeSystemDir(installDir);
    mgr        = new VersionArchiveManager(installDir, sysDir);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // archiveCurrentSystem
  // --------------------------------------------------------------------------

  it("archiveCurrentSystem creates a versioned snapshot directory", async () => {
    await mgr.archiveCurrentSystem("0.10.0");
    const versionDir = join(installDir, "versions", "0.10.0");
    expect(existsSync(versionDir)).toBe(true);
    expect(existsSync(join(versionDir, "system.tar.gz"))).toBe(true);
  });

  it("archiveCurrentSystem updates the manifest", async () => {
    await mgr.archiveCurrentSystem("0.10.0");
    const manifest = await mgr.getManifest();
    expect(manifest.currentVersion).toBe("0.10.0");
    expect(manifest.versions).toHaveLength(1);
    expect(manifest.versions[0]!.version).toBe("0.10.0");
  });

  it("archiveCurrentSystem records governance ruleset version", async () => {
    await mgr.archiveCurrentSystem("0.10.0");
    const manifest = await mgr.getManifest();
    expect(manifest.versions[0]!.governanceRulesetVersion).toBe("1.0");
  });

  it("archiveCurrentSystem records sizeBytes > 0", async () => {
    await mgr.archiveCurrentSystem("0.10.0");
    const manifest = await mgr.getManifest();
    expect(manifest.versions[0]!.sizeBytes).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // restoreSystem
  // --------------------------------------------------------------------------

  it("restoreSystem replaces current system/ from archive", async () => {
    await mgr.archiveCurrentSystem("0.10.0");

    // Corrupt current system
    rmSync(join(sysDir, "governance", "rules.yaml"));
    expect(existsSync(join(sysDir, "governance", "rules.yaml"))).toBe(false);

    await mgr.restoreSystem("0.10.0");
    expect(existsSync(join(sysDir, "governance", "rules.yaml"))).toBe(true);
  });

  it("restoreSystem throws for unknown version", async () => {
    await expect(mgr.restoreSystem("9.9.9")).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // listVersions
  // --------------------------------------------------------------------------

  it("listVersions returns empty array when no archives", async () => {
    const versions = await mgr.listVersions();
    expect(versions).toHaveLength(0);
  });

  it("listVersions returns all archived versions", async () => {
    await mgr.archiveCurrentSystem("0.10.0");
    await mgr.archiveCurrentSystem("0.9.9");
    const versions = await mgr.listVersions();
    expect(versions.length).toBe(2);
    const versionStrings = versions.map((v) => v.version);
    expect(versionStrings).toContain("0.10.0");
    expect(versionStrings).toContain("0.9.9");
  });

  // --------------------------------------------------------------------------
  // getManifest
  // --------------------------------------------------------------------------

  it("getManifest returns empty manifest when no archives", async () => {
    const manifest = await mgr.getManifest();
    expect(manifest.versions).toHaveLength(0);
    expect(manifest.currentVersion).toBe("unknown");
  });

  // --------------------------------------------------------------------------
  // cleanupOldVersions
  // --------------------------------------------------------------------------

  it("cleanupOldVersions removes versions beyond the keep limit", async () => {
    await mgr.archiveCurrentSystem("0.10.0");
    await mgr.archiveCurrentSystem("0.9.9");
    await mgr.archiveCurrentSystem("0.9.8");
    await mgr.archiveCurrentSystem("0.9.7");

    await mgr.cleanupOldVersions(2);

    const manifest = await mgr.getManifest();
    expect(manifest.versions.length).toBe(2);
  });

  it("cleanupOldVersions does nothing when count <= keep", async () => {
    await mgr.archiveCurrentSystem("0.10.0");
    await mgr.cleanupOldVersions(3);
    const manifest = await mgr.getManifest();
    expect(manifest.versions.length).toBe(1);
  });
});
