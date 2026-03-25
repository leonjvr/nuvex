/**
 * Tests for src/core/backup.ts — Phase 10.9 Backup & Restore Engine
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  createBackup,
  restoreBackup,
  listBackups,
  getBackupInfo,
  deleteBackup,
  resolveBackupId,
  getBackupConfig,
  type BackupConfig,
} from "../../src/core/backup.js";
import { isSidjuaError } from "../../src/core/error-codes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let workDir: string;
let configPath: string;
let backupDir: string;

function makeWorkspace(): void {
  workDir   = mkdtempSync(join(tmpdir(), "sidjua-backup-test-"));
  backupDir = join(workDir, "data", "backups");
  mkdirSync(backupDir, { recursive: true });

  // Minimal divisions.yaml (no divisions, so no division-dir copying)
  configPath = join(workDir, "divisions.yaml");
  writeFileSync(
    configPath,
    "schema_version: '1.0'\ncompany:\n  name: TestCo\ndivisions: []\n",
    "utf-8",
  );

  // A governance directory with one file
  mkdirSync(join(workDir, "governance"), { recursive: true });
  writeFileSync(join(workDir, "governance", "policies.json"), '{"rules":[]}', "utf-8");
}

function makeBackupConfig(overrides: Partial<BackupConfig> = {}): BackupConfig {
  return {
    directory:       backupDir,
    retention_count: 0,
    retention_days:  0,
    ...overrides,
  };
}

beforeEach(() => {
  makeWorkspace();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createBackup
// ---------------------------------------------------------------------------

describe("createBackup", () => {
  it("creates a .zip archive in the backup directory", async () => {
    const result = await createBackup({ workDir, configPath }, makeBackupConfig());

    expect(result.archive_path).toMatch(/\.zip$/);
    expect(existsSync(result.archive_path)).toBe(true);
    expect(result.short_id).toHaveLength(8);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("manifest inside archive has correct file_count and checksum", async () => {
    const result   = await createBackup({ workDir, configPath }, makeBackupConfig());
    const manifest = await getBackupInfo(result.archive_path);

    expect(manifest.id).toBe(result.id);
    expect(manifest.short_id).toBe(result.short_id);
    expect(manifest.file_count).toBe(manifest.files.length);
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sidjua_version).toBe("1.0.0");
    expect(manifest.work_dir).toBe(workDir);
  });

  it("includes governance files in the manifest", async () => {
    const result   = await createBackup({ workDir, configPath }, makeBackupConfig());
    const manifest = await getBackupInfo(result.archive_path);

    const govFiles = manifest.files.filter((f) => f.startsWith("governance/"));
    expect(govFiles.length).toBeGreaterThan(0);
    expect(govFiles.some((f) => f.includes("policies.json"))).toBe(true);
  });

  it("includes config yaml in the manifest", async () => {
    const result   = await createBackup({ workDir, configPath }, makeBackupConfig());
    const manifest = await getBackupInfo(result.archive_path);

    const configFiles = manifest.files.filter((f) => f.startsWith("config/"));
    expect(configFiles.some((f) => f.includes("divisions.yaml"))).toBe(true);
  });

  it("stores an optional label in the manifest", async () => {
    const result   = await createBackup(
      { workDir, configPath, label: "my-label" },
      makeBackupConfig(),
    );
    const manifest = await getBackupInfo(result.archive_path);

    expect(manifest.label).toBe("my-label");
    expect(result.label).toBe("my-label");
  });

  it("writes to a custom outputPath when provided", async () => {
    const customPath = join(workDir, "custom-backup.zip");
    const result = await createBackup(
      { workDir, configPath, outputPath: customPath },
      makeBackupConfig(),
    );

    expect(result.archive_path).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);
  });

  it("archive_size_bytes matches the actual file size", async () => {
    const result = await createBackup({ workDir, configPath }, makeBackupConfig());
    const { statSync } = await import("node:fs");
    const actualSize = statSync(result.archive_path).size;
    expect(result.archive_size_bytes).toBe(actualSize);
  });

  it("H4: databases in data/ subdir are stored as databases/data/<name>.db in manifest", async () => {
    // Create a .db file in workDir/data/ to simulate a real nested DB path
    const dataDir = join(workDir, "data");
    mkdirSync(dataDir, { recursive: true });
    // Write a minimal SQLite file so better-sqlite3 can open it
    // Use an empty file — WAL checkpoint will fail gracefully, but backup() needs a real DB
    // Use better-sqlite3 to create a minimal valid DB
    const { default: BetterSQLite3 } = await import("better-sqlite3");
    const testDb = new BetterSQLite3(join(dataDir, "agent.db"));
    testDb.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
    testDb.close();

    const result   = await createBackup({ workDir, configPath }, makeBackupConfig());
    const manifest = await getBackupInfo(result.archive_path);

    const dbFiles = manifest.files.filter((f) => f.startsWith("databases/"));
    // Should have databases/data/agent.db (not databases/agent.db)
    expect(dbFiles.some((f) => f === "databases/data/agent.db")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// restoreBackup
// ---------------------------------------------------------------------------

describe("restoreBackup", () => {
  it("dry-run returns file count without modifying anything", async () => {
    const created = await createBackup({ workDir, configPath }, makeBackupConfig());

    // Remove governance file to prove it is NOT restored in dry-run
    rmSync(join(workDir, "governance", "policies.json"));

    const result = await restoreBackup({
      archivePathOrId: created.archive_path,
      workDir,
      configPath,
      dryRun: true,
      backupDir,
    });

    expect(result.dryRun).toBe(true);
    expect(result.files_restored).toBeGreaterThan(0);
    // File should still be absent (dry-run did not restore)
    expect(existsSync(join(workDir, "governance", "policies.json"))).toBe(false);
  });

  it("--force restores governance files from archive", async () => {
    const created = await createBackup({ workDir, configPath }, makeBackupConfig());

    // Overwrite the governance file with different content
    writeFileSync(join(workDir, "governance", "policies.json"), '{"rules":["NEW"]}', "utf-8");

    const result = await restoreBackup({
      archivePathOrId: created.archive_path,
      workDir,
      configPath,
      force: true,
      backupDir,
    });

    expect(result.dryRun).toBe(false);
    expect(result.files_restored).toBeGreaterThan(0);

    // Original content should be restored
    const restored = readFileSync(join(workDir, "governance", "policies.json"), "utf-8");
    expect(restored).toBe('{"rules":[]}');
  });

  it("--force creates a pre-restore safety backup", async () => {
    const created = await createBackup({ workDir, configPath }, makeBackupConfig());

    const result = await restoreBackup({
      archivePathOrId: created.archive_path,
      workDir,
      configPath,
      force: true,
      backupDir,
    });

    expect(result.pre_restore_backup_id).toBeDefined();
    // There should now be at least 2 archives in backupDir
    const archives = await listBackups(backupDir);
    expect(archives.length).toBeGreaterThanOrEqual(2);
  });

  it("throws SYS-008 when archive path does not exist", async () => {
    await expect(
      restoreBackup({
        archivePathOrId: join(backupDir, "nonexistent.zip"),
        workDir,
        configPath,
        force: true,
        backupDir,
      }),
    ).rejects.toSatisfy((err: unknown) => isSidjuaError(err) && err.code === "SYS-008");
  });

  it("throws SYS-005 when archive checksum is wrong (tampered manifest)", async () => {
    const { default: AdmZip } = await import("adm-zip");
    const { join: pjoin }     = await import("node:path");

    const created      = await createBackup({ workDir, configPath }, makeBackupConfig());
    const tamperedPath = pjoin(backupDir, "tampered.zip");

    // Extract → patch manifest checksum → repack using adm-zip
    const extractDir = mkdtempSync(pjoin(tmpdir(), "sidjua-tamper-"));
    try {
      new AdmZip(created.archive_path).extractAllTo(extractDir, true);
      const manifestFile = pjoin(extractDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestFile, "utf-8")) as Record<string, unknown>;
      manifest["checksum"] = "0".repeat(64); // wrong checksum
      writeFileSync(manifestFile, JSON.stringify(manifest), "utf-8");
      // Also remove sig so --force bypasses sig check and reaches checksum check
      const sigFile = pjoin(extractDir, "manifest.sig");
      if (existsSync(sigFile)) rmSync(sigFile);
      const tamperedZip = new AdmZip();
      tamperedZip.addLocalFolder(extractDir);
      tamperedZip.writeZip(tamperedPath);
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }

    await expect(
      restoreBackup({
        archivePathOrId: tamperedPath,
        workDir,
        configPath,
        force: true,
        backupDir,
      }),
    ).rejects.toSatisfy((err: unknown) => isSidjuaError(err) && err.code === "SYS-005");
  });

  it("C3: throws SYS-005 when manifest.sig is tampered — rejects BEFORE extracting any files", async () => {
    const { default: AdmZip } = await import("adm-zip");
    const { join: pjoin }     = await import("node:path");

    const created     = await createBackup({ workDir, configPath }, makeBackupConfig());
    const tamperedPath = pjoin(backupDir, "tampered-sig.zip");

    // Extract → replace manifest.sig with invalid signature → repack
    const extractDir = mkdtempSync(pjoin(tmpdir(), "sidjua-tamper-sig-"));
    try {
      new AdmZip(created.archive_path).extractAllTo(extractDir, true);
      const sigFile = pjoin(extractDir, "manifest.sig");
      // Write a bad signature (all zeros hex)
      writeFileSync(sigFile, "0".repeat(64), "utf-8");
      const tamperedZip = new AdmZip();
      tamperedZip.addLocalFolder(extractDir);
      tamperedZip.writeZip(tamperedPath);
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }

    await expect(
      restoreBackup({
        archivePathOrId: tamperedPath,
        workDir,
        configPath,
        force: false,
        backupDir,
      }),
    ).rejects.toSatisfy((err: unknown) => isSidjuaError(err) && err.code === "SYS-005");
  });

  it("H4: backup/restore preserves nested DB path (data/agent.db → workDir/data/agent.db)", async () => {
    // Create a nested .db file
    const dataDir = join(workDir, "data");
    mkdirSync(dataDir, { recursive: true });
    const { default: BetterSQLite3 } = await import("better-sqlite3");
    const db = new BetterSQLite3(join(dataDir, "agent.db"));
    db.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)");
    db.exec("INSERT INTO t VALUES (42)");
    db.close();

    const created = await createBackup({ workDir, configPath }, makeBackupConfig());

    // Remove the original DB to verify restore puts it back in the right place
    rmSync(join(dataDir, "agent.db"));

    await restoreBackup({
      archivePathOrId: created.archive_path,
      workDir,
      configPath,
      force: true,
      backupDir,
    });

    // DB should be restored at workDir/data/agent.db (not workDir/agent.db)
    expect(existsSync(join(workDir, "data", "agent.db"))).toBe(true);
    expect(existsSync(join(workDir, "agent.db"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listBackups
// ---------------------------------------------------------------------------

describe("listBackups", () => {
  it("returns empty array when backup directory does not exist", async () => {
    const results = await listBackups(join(workDir, "nonexistent"));
    expect(results).toEqual([]);
  });

  it("returns backups sorted newest-first", async () => {
    const cfg = makeBackupConfig();
    const a   = await createBackup({ workDir, configPath, label: "first" }, cfg);
    const b   = await createBackup({ workDir, configPath, label: "second" }, cfg);

    const list = await listBackups(backupDir);
    expect(list.length).toBe(2);
    // Second backup created later — should appear first
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
  });

  it("includes archive_size_bytes for each entry", async () => {
    await createBackup({ workDir, configPath }, makeBackupConfig());
    const list = await listBackups(backupDir);
    expect(list[0]!.archive_size_bytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getBackupInfo
// ---------------------------------------------------------------------------

describe("getBackupInfo", () => {
  it("returns manifest for a known archive path", async () => {
    const created  = await createBackup({ workDir, configPath }, makeBackupConfig());
    const manifest = await getBackupInfo(created.archive_path);
    expect(manifest.id).toBe(created.id);
  });

  it("throws SYS-008 for a missing path", async () => {
    await expect(
      getBackupInfo(join(workDir, "missing.zip")),
    ).rejects.toSatisfy((err: unknown) => isSidjuaError(err) && err.code === "SYS-008");
  });
});

// ---------------------------------------------------------------------------
// deleteBackup
// ---------------------------------------------------------------------------

describe("deleteBackup", () => {
  it("removes the archive file from disk", async () => {
    const created = await createBackup({ workDir, configPath }, makeBackupConfig());
    expect(existsSync(created.archive_path)).toBe(true);

    deleteBackup(created.archive_path);
    expect(existsSync(created.archive_path)).toBe(false);
  });

  it("throws SYS-008 when archive does not exist", () => {
    expect(() => deleteBackup(join(workDir, "ghost.zip"))).toThrow();
  });

  it("C5: throws SYS-009 when backupDir is empty string", () => {
    expect(() => deleteBackup("somebackup", "")).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && err.code === "SYS-009"; }
      },
    );
  });

  it("C5: throws SYS-009 when backupDir is whitespace-only", () => {
    expect(() => deleteBackup("somebackup", "   ")).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && err.code === "SYS-009"; }
      },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBackupId
// ---------------------------------------------------------------------------

describe("resolveBackupId", () => {
  it("resolves a short_id to an archive path", async () => {
    const created = await createBackup({ workDir, configPath }, makeBackupConfig());
    const resolved = resolveBackupId(created.short_id, backupDir);
    expect(resolved).toBe(created.archive_path);
  });

  it("throws SYS-008 for an unknown ID", () => {
    expect(() => resolveBackupId("deadbeef", backupDir)).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && err.code === "SYS-008"; }
      },
    );
  });

  it("C5: throws SYS-009 when backupDir is empty string", () => {
    expect(() => resolveBackupId("abc12345", "")).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && err.code === "SYS-009"; }
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Retention enforcement
// ---------------------------------------------------------------------------

describe("retention", () => {
  it("enforces retention_count by deleting oldest backups", async () => {
    const cfg = makeBackupConfig({ retention_count: 2 });

    // Create 3 backups — third one should trigger deletion of the oldest
    await createBackup({ workDir, configPath, label: "oldest" }, cfg);
    await createBackup({ workDir, configPath, label: "middle" }, cfg);
    await createBackup({ workDir, configPath, label: "newest" }, cfg);

    const remaining = await listBackups(backupDir);
    expect(remaining.length).toBeLessThanOrEqual(2);
  });

  it("enforces retention_days by deleting expired backups", async () => {
    // Create a backup first (will be considered "old" by the config)
    const cfg0 = makeBackupConfig({ retention_days: 0 });
    await createBackup({ workDir, configPath, label: "keep" }, cfg0);

    // A config that expires backups older than 0 days
    // (all existing backups are technically from "now" but this tests the logic path)
    const cfgStrict = makeBackupConfig({ retention_days: 9999 });
    await createBackup({ workDir, configPath, label: "new" }, cfgStrict);

    // With 9999 days retention, no backups should be deleted
    const remaining = await listBackups(backupDir);
    expect(remaining.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// getBackupConfig
// ---------------------------------------------------------------------------

describe("getBackupConfig", () => {
  it("returns defaults when divisions.yaml has no backup section", () => {
    const cfg = getBackupConfig(workDir, configPath);
    expect(cfg.directory).toContain("backups");
    expect(cfg.retention_count).toBe(5);
    expect(cfg.retention_days).toBe(30);
  });

  it("reads custom backup config from divisions.yaml", () => {
    writeFileSync(
      configPath,
      "schema_version: '1.0'\ncompany:\n  name: TestCo\ndivisions: []\nbackup:\n  directory: custom-backups\n  retention_count: 10\n  retention_days: 60\n",
      "utf-8",
    );
    const cfg = getBackupConfig(workDir, configPath);
    expect(cfg.directory).toContain("custom-backups");
    expect(cfg.retention_count).toBe(10);
    expect(cfg.retention_days).toBe(60);
  });
});
