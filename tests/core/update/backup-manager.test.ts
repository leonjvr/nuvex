// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/update/backup-manager.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync,
  existsSync, readFileSync, statSync,
} from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import { UpdateBackupManager, type BackupInfo } from "../../../src/core/update/backup-manager.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-backup-test-"));
}

/** Create a minimal system/ directory with some governance files. */
function makeSystemDir(dir: string): string {
  const sysDir = join(dir, "system");
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
  writeFileSync(join(sysDir, "governance", "rules.yaml"), "rules:\n  - id: TEST-001\n");
  return sysDir;
}

describe("UpdateBackupManager", () => {
  let tmp:    string;
  let sysDir: string;
  let mgr:    UpdateBackupManager;

  beforeEach(() => {
    tmp    = makeTempDir();
    sysDir = makeSystemDir(tmp);
    mgr    = new UpdateBackupManager(tmp, sysDir);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // createPreUpdateBackup
  // --------------------------------------------------------------------------

  it("createPreUpdateBackup returns BackupInfo with type=pre-update", async () => {
    const info = await mgr.createPreUpdateBackup("0.10.1");
    expect(info.type).toBe("pre-update");
    expect(info.id).toContain("pre-0.10.1");
    expect(info.contents.systemSnapshot).toBe(true);
    expect(info.createdAt).toBeDefined();
  });

  it("createPreUpdateBackup writes manifest.json and system.tar.gz", async () => {
    const info = await mgr.createPreUpdateBackup("0.10.1");
    const backupDir = join(tmp, "backups", info.id);
    expect(existsSync(join(backupDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(backupDir, "system.tar.gz"))).toBe(true);
  });

  it("system.tar.gz is a real file (not empty)", async () => {
    const info = await mgr.createPreUpdateBackup("0.10.1");
    const archivePath = join(tmp, "backups", info.id, "system.tar.gz");
    const st = statSync(archivePath);
    expect(st.size).toBeGreaterThan(0);
  });

  it("backup manifest contains correct sidjuaVersion and govRulesetVersion", async () => {
    const info = await mgr.createPreUpdateBackup("0.10.1");
    expect(info.governanceRulesetVersion).toBe("1.0");
    // sidjuaVersion read from system/VERSION
    expect(info.sidjuaVersion).toBe("0.10.0");
  });

  it("backup copies .migration-state.json when it exists", async () => {
    const state = { schemaVersion: 3, appliedMigrations: [{ id: "001", appliedAt: "2026-01-01Z", version: "0.9.0" }] };
    writeFileSync(join(tmp, ".migration-state.json"), JSON.stringify(state));

    const info = await mgr.createPreUpdateBackup("0.10.1");
    expect(info.contents.schemaState).toBe(true);
    const backupDir = join(tmp, "backups", info.id);
    expect(existsSync(join(backupDir, ".migration-state.json"))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // createManualBackup
  // --------------------------------------------------------------------------

  it("createManualBackup with label sets type=manual and includes label", async () => {
    const info = await mgr.createManualBackup("before-experiment");
    expect(info.type).toBe("manual");
    expect(info.label).toBe("before-experiment");
    expect(info.id).toContain("manual");
    expect(info.id).toContain("before-experiment");
  });

  it("createManualBackup without label creates valid backup", async () => {
    const info = await mgr.createManualBackup();
    expect(info.type).toBe("manual");
    expect(info.label).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // listBackups
  // --------------------------------------------------------------------------

  it("listBackups returns empty array when no backups", async () => {
    const list = await mgr.listBackups();
    expect(list).toHaveLength(0);
  });

  it("listBackups returns all created backups", async () => {
    await mgr.createPreUpdateBackup("0.10.1");
    await mgr.createManualBackup("test");
    const list = await mgr.listBackups();
    expect(list.length).toBe(2);
  });

  it("listBackups returns sorted by newest first", async () => {
    const a = await mgr.createPreUpdateBackup("0.10.1");
    await new Promise((r) => setTimeout(r, 10));
    const b = await mgr.createManualBackup("later");
    const list = await mgr.listBackups();
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
  });

  // --------------------------------------------------------------------------
  // restoreBackup
  // --------------------------------------------------------------------------

  it("restoreBackup restores system files from backup", async () => {
    const info = await mgr.createPreUpdateBackup("0.10.1");

    // Corrupt system/
    rmSync(join(sysDir, "governance", "rules.yaml"));

    await mgr.restoreBackup(info.id);
    // File should be restored
    expect(existsSync(join(sysDir, "governance", "rules.yaml"))).toBe(true);
  });

  it("restoreBackup throws for unknown backup ID", async () => {
    await expect(mgr.restoreBackup("nonexistent-id")).rejects.toThrow("not found");
  });

  // --------------------------------------------------------------------------
  // cleanupOldBackups
  // --------------------------------------------------------------------------

  it("cleanupOldBackups deletes backups beyond max_backups", async () => {
    // Create retention policy with max_backups=2, min_keep=1
    mkdirSync(join(tmp, "backups"), { recursive: true });
    writeFileSync(join(tmp, "backups", "retention.json"), JSON.stringify({
      max_backups: 2, max_age_days: 90, min_keep: 1, auto_cleanup: true,
    }));

    await mgr.createPreUpdateBackup("0.10.1");
    await mgr.createPreUpdateBackup("0.10.2");
    await mgr.createPreUpdateBackup("0.10.3");

    const deleted = await mgr.cleanupOldBackups();
    expect(deleted).toBeGreaterThan(0);
    const remaining = await mgr.listBackups();
    expect(remaining.length).toBeLessThanOrEqual(2);
  });

  it("cleanupOldBackups always keeps min_keep backups", async () => {
    mkdirSync(join(tmp, "backups"), { recursive: true });
    writeFileSync(join(tmp, "backups", "retention.json"), JSON.stringify({
      max_backups: 1, max_age_days: 0, min_keep: 2, auto_cleanup: true,
    }));

    await mgr.createPreUpdateBackup("0.10.1");
    await mgr.createPreUpdateBackup("0.10.2");
    await mgr.createPreUpdateBackup("0.10.3");

    await mgr.cleanupOldBackups();
    const remaining = await mgr.listBackups();
    expect(remaining.length).toBeGreaterThanOrEqual(2);
  });

  it("cleanupOldBackups returns 0 when nothing to clean", async () => {
    const deleted = await mgr.cleanupOldBackups();
    expect(deleted).toBe(0);
  });
});
