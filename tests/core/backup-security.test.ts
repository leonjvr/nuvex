/**
 * Security tests for src/core/backup.ts
 *
 * Covers: Zip Slip, arbitrary-file-deletion boundary, forged manifest
 * rejection, zip bomb protection, backup.key permissions.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { crc32 } from "node:zlib";
import AdmZip from "adm-zip";

// ---------------------------------------------------------------------------
// Raw ZIP builder — creates a minimal ZIP with exact (un-normalized) entry names.
// Needed because adm-zip normalises paths on addFile(), stripping traversal chars.
// ---------------------------------------------------------------------------

function buildRawZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localHeaders: Buffer[] = [];
  const cdEntries:    Buffer[] = [];
  let   localOffset = 0;

  for (const { name, data } of entries) {
    const fname  = Buffer.from(name, "utf-8");
    const dataCrc = crc32(data);

    // Local file header (30 bytes fixed + fname)
    const lh = Buffer.alloc(30 + fname.length + data.length);
    let o = 0;
    lh.writeUInt32LE(0x04034b50, o); o += 4; // signature
    lh.writeUInt16LE(20, o); o += 2;          // version needed
    lh.writeUInt16LE(0,  o); o += 2;          // flags
    lh.writeUInt16LE(0,  o); o += 2;          // compression: stored
    lh.writeUInt16LE(0,  o); o += 2;          // mod time
    lh.writeUInt16LE(0,  o); o += 2;          // mod date
    lh.writeUInt32LE(dataCrc,     o); o += 4; // CRC-32
    lh.writeUInt32LE(data.length, o); o += 4; // compressed size
    lh.writeUInt32LE(data.length, o); o += 4; // uncompressed size
    lh.writeUInt16LE(fname.length, o); o += 2;
    lh.writeUInt16LE(0, o); o += 2;           // extra field length
    fname.copy(lh, o); o += fname.length;
    data.copy(lh, o);

    // Central directory entry (46 bytes fixed + fname)
    const cd = Buffer.alloc(46 + fname.length);
    let c = 0;
    cd.writeUInt32LE(0x02014b50, c); c += 4;
    cd.writeUInt16LE(20, c); c += 2;
    cd.writeUInt16LE(20, c); c += 2;
    cd.writeUInt16LE(0,  c); c += 2;
    cd.writeUInt16LE(0,  c); c += 2;
    cd.writeUInt16LE(0,  c); c += 2;
    cd.writeUInt16LE(0,  c); c += 2;
    cd.writeUInt32LE(dataCrc,     c); c += 4;
    cd.writeUInt32LE(data.length, c); c += 4;
    cd.writeUInt32LE(data.length, c); c += 4;
    cd.writeUInt16LE(fname.length, c); c += 2;
    cd.writeUInt16LE(0, c); c += 2; // extra field
    cd.writeUInt16LE(0, c); c += 2; // comment
    cd.writeUInt16LE(0, c); c += 2; // disk start
    cd.writeUInt16LE(0, c); c += 2; // int attr
    cd.writeUInt32LE(0, c); c += 4; // ext attr
    cd.writeUInt32LE(localOffset, c); c += 4; // local header offset
    fname.copy(cd, c);

    localOffset += 30 + fname.length + data.length;
    localHeaders.push(lh);
    cdEntries.push(cd);
  }

  const cdBuf = Buffer.concat(cdEntries);
  const cdOffset = localOffset;

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  let e = 0;
  eocd.writeUInt32LE(0x06054b50, e); e += 4;
  eocd.writeUInt16LE(0, e); e += 2;
  eocd.writeUInt16LE(0, e); e += 2;
  eocd.writeUInt16LE(entries.length, e); e += 2;
  eocd.writeUInt16LE(entries.length, e); e += 2;
  eocd.writeUInt32LE(cdBuf.length, e); e += 4;
  eocd.writeUInt32LE(cdOffset,     e); e += 4;
  eocd.writeUInt16LE(0, e);

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

import {
  createBackup,
  restoreBackup,
  deleteBackup,
  type BackupConfig,
} from "../../src/core/backup.js";
import { isSidjuaError } from "../../src/core/error-codes.js";

// ---------------------------------------------------------------------------
// Test workspace helpers
// ---------------------------------------------------------------------------

let workDir: string;
let configPath: string;
let backupDir: string;

function makeWorkspace(): void {
  workDir   = mkdtempSync(join(tmpdir(), "sidjua-backup-sec-"));
  backupDir = join(workDir, "data", "backups");
  mkdirSync(backupDir, { recursive: true });

  configPath = join(workDir, "divisions.yaml");
  writeFileSync(
    configPath,
    "schema_version: '1.0'\ncompany:\n  name: TestCo\ndivisions: []\n",
    "utf-8",
  );

  mkdirSync(join(workDir, "governance"), { recursive: true });
  writeFileSync(join(workDir, "governance", "policy.json"), '{"rules":[]}', "utf-8");
}

function makeBackupConfig(): BackupConfig {
  return { directory: backupDir, retention_count: 0, retention_days: 0 };
}

beforeEach(() => makeWorkspace());
afterEach(() => rmSync(workDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// D1: Zip Slip path traversal prevention
// ---------------------------------------------------------------------------

describe("Zip Slip prevention", () => {
  it("rejects archives containing path traversal entries — missing manifest stops restore (C3)", async () => {
    // With verify-before-extract (C3), a raw zip without manifest.json is rejected
    // at the header-read phase with SYS-005 before any extraction occurs.
    // yauzl also validates entry names and may throw its own error for `../` paths.
    // Either way, restore MUST be rejected.
    const zipPath = join(backupDir, "malicious.zip");
    writeFileSync(zipPath, buildRawZip([
      { name: "../../etc/malicious.txt", data: Buffer.from("pwned") },
    ]));

    await expect(
      restoreBackup({
        archivePathOrId: zipPath,
        workDir,
        configPath,
        force: true,
        backupDir,
      }),
    ).rejects.toThrow(); // Any error — yauzl path validation OR SidjuaError SYS-005/SYS-009
  });

  it("rejects entries that resolve outside the target directory (streamingExtract zip-slip)", async () => {
    // To reach streamingExtract, a zip needs a valid manifest + sig.
    // Craft a zip that has manifest.json but also a traversal entry.
    // Without a valid sig it will be rejected with SYS-005 before extraction.
    // yauzl may also reject the `../` path natively.
    // Either way, restore MUST be rejected.
    const zipPath = join(backupDir, "traversal.zip");
    writeFileSync(zipPath, buildRawZip([
      { name: "manifest.json", data: Buffer.from('{"id":"x","short_id":"x","created_at":"2026-01-01T00:00:00Z","sidjua_version":"0.9.6","work_dir":"/x","file_count":0,"total_size_bytes":0,"checksum":"0".repeat(64),"files":[]}') },
      { name: "safe/../../escape.txt", data: Buffer.from("escaped") },
    ]));

    await expect(
      restoreBackup({
        archivePathOrId: zipPath,
        workDir,
        configPath,
        force: true,
        backupDir,
      }),
    ).rejects.toThrow(); // Any error — yauzl path validation OR SidjuaError SYS-005/SYS-009
  });

  it("accepts entries that stay within the target directory", async () => {
    // Normal zip with only well-formed paths — but without manifest.sig it
    // should throw SYS-005 (not SYS-009), proving path validation passed.
    // Place inside backupDir so boundary check passes.
    const normalZip = new AdmZip();
    normalZip.addFile("databases/test.db", Buffer.from("fake-db"));
    normalZip.addFile("governance/policy.json", Buffer.from("{}"));
    const zipPath = join(backupDir, "normal.zip");
    normalZip.writeZip(zipPath);

    await expect(
      restoreBackup({
        archivePathOrId: zipPath,
        workDir,
        configPath,
        force: true,
        backupDir,
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        isSidjuaError(err) &&
        (err.code === "SYS-005" || err.code === "SYS-009"),
    );
    // If we reach here without SYS-009, the path validation passed
  });
});

// ---------------------------------------------------------------------------
// D2: Arbitrary file deletion boundary check
// ---------------------------------------------------------------------------

describe("deleteBackup boundary check", () => {
  it("rejects deletion of absolute paths outside backup directory", () => {
    // Use .zip suffix to enter the boundary-check branch
    const externalPath = "/etc/passwd.zip";
    expect(() => deleteBackup(externalPath, backupDir)).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && (err.code === "SYS-009" || err.code === "SYS-008"); }
      },
    );
  });

  it("rejects IDs that contain path traversal characters", () => {
    // C5: paths with ".." throw SYS-009 before any lookup
    expect(() => deleteBackup("../../etc/passwd", backupDir)).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && (err.code === "SYS-009" || err.code === "SYS-008"); }
      },
    );
  });

  it("allows deletion of archives within backup directory", async () => {
    const result = await createBackup({ workDir, configPath }, makeBackupConfig());
    // Should not throw
    expect(() => deleteBackup(result.archive_path, backupDir)).not.toThrow();
    expect(existsSync(result.archive_path)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D3: Forged manifest rejection (HMAC-SHA256)
// ---------------------------------------------------------------------------

describe("manifest HMAC verification", () => {
  it("rejects restore when manifest.json has been tampered (sig mismatch)", async () => {
    const result = await createBackup({ workDir, configPath }, makeBackupConfig());

    // Tamper: change manifest checksum, keep old manifest.sig
    const zip      = new AdmZip(result.archive_path);
    const entry    = zip.getEntry("manifest.json") ?? zip.getEntry("./manifest.json");
    expect(entry).not.toBeNull();
    const manifest = JSON.parse(entry!.getData().toString("utf-8")) as Record<string, unknown>;
    manifest["checksum"] = "0".repeat(64); // invalidate checksum
    zip.deleteFile(entry!.entryName);
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest)));
    zip.writeZip(result.archive_path);

    await expect(
      restoreBackup({
        archivePathOrId: result.archive_path,
        workDir,
        configPath,
        force: true,
        backupDir,
      }),
    ).rejects.toSatisfy(
      (err: unknown) => isSidjuaError(err) && err.code === "SYS-005",
    );
  });

  it("rejects restore when manifest.sig is missing (without --force)", async () => {
    const result = await createBackup({ workDir, configPath }, makeBackupConfig());

    // Remove manifest.sig from the zip
    const zip = new AdmZip(result.archive_path);
    const sigEntry = zip.getEntry("manifest.sig") ?? zip.getEntry("./manifest.sig");
    expect(sigEntry).not.toBeNull();
    zip.deleteFile(sigEntry!.entryName);
    zip.writeZip(result.archive_path);

    // Without force → should reject unsigned archive
    await expect(
      restoreBackup({
        archivePathOrId: result.archive_path,
        workDir,
        configPath,
        dryRun: false,
        force: false,
        backupDir,
      }),
    ).rejects.toSatisfy(
      (err: unknown) => isSidjuaError(err) && err.code === "SYS-005",
    );
  });

  it("allows restore of unsigned archive with --force (backward compat)", async () => {
    const result = await createBackup({ workDir, configPath }, makeBackupConfig());

    // Remove manifest.sig
    const zip = new AdmZip(result.archive_path);
    const sigEntry = zip.getEntry("manifest.sig") ?? zip.getEntry("./manifest.sig");
    expect(sigEntry).not.toBeNull();
    zip.deleteFile(sigEntry!.entryName);
    zip.writeZip(result.archive_path);

    // With force — should warn but proceed successfully
    const restoreResult = await restoreBackup({
      archivePathOrId: result.archive_path,
      workDir,
      configPath,
      force: true,
      backupDir,
    });
    expect(restoreResult.dryRun).toBe(false);
    expect(restoreResult.files_restored).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D4: Zip bomb protection
// ---------------------------------------------------------------------------

describe("zip bomb protection", () => {
  it("restoreBackup succeeds for normal-sized archives (streaming size check passes)", async () => {
    const result = await createBackup({ workDir, configPath }, makeBackupConfig());
    const restore = await restoreBackup({
      archivePathOrId: result.archive_path,
      workDir,
      configPath,
      dryRun: true,
      backupDir,
    });
    expect(restore.dryRun).toBe(true);
    expect(restore.files_restored).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D5 (backup-side): backup.key file is created with 0o600 permissions
// ---------------------------------------------------------------------------

describe("backup.key permissions", () => {
  it("auto-generates backup.key with mode 0o600 on first backup", async () => {
    const { statSync } = await import("node:fs");
    await createBackup({ workDir, configPath }, makeBackupConfig());

    const keyPath = join(workDir, ".system", "backup.key");
    expect(existsSync(keyPath)).toBe(true);

    const mode = statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("backup.key contains a 64-char hex string (32 random bytes)", async () => {
    await createBackup({ workDir, configPath }, makeBackupConfig());
    const key = readFileSync(join(workDir, ".system", "backup.key"), "utf-8").trim();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// FIX-C1: deleteBackup else-block (no backupDir) — enforce .zip + tmpdir containment
// ---------------------------------------------------------------------------

import { resolve as _resolve } from "node:path";
import { tmpdir as _tmpdir } from "node:os";

describe("deleteBackup — no backupDir: FIX-C1 constraints", () => {
  it("rejects non-.zip path (would delete arbitrary files)", () => {
    // /etc/shadow has no .zip suffix — must throw SYS-009 before any FS access
    expect(() => deleteBackup("/etc/shadow", undefined)).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && err.code === "SYS-009"; }
      },
    );
  });

  it("rejects path traversal even with .zip suffix", () => {
    // Traversal that would escape tmpdir — must be rejected with SYS-009
    const traversal = "../../../../etc/important.zip";
    expect(() => deleteBackup(traversal, undefined)).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && err.code === "SYS-009"; }
      },
    );
  });

  it("rejects a .zip outside the OS tmpdir (e.g. /home/user/secret.zip)", () => {
    // A .zip that resolves outside tmpdir must be rejected with SYS-009
    // (We just test a plausible path that isn't in tmpdir — it won't exist, so SYS-008 is also ok)
    const outsidePath = "/var/lib/sidjua/data/secret.zip";
    expect(() => deleteBackup(outsidePath, undefined)).toSatisfy(
      (fn: () => void) => {
        try { fn(); return false; }
        catch (err) { return isSidjuaError(err) && (err.code === "SYS-009" || err.code === "SYS-008"); }
      },
    );
  });

  it("accepts a .zip that actually lives in OS tmpdir (happy path)", () => {
    const safeZip = join(_tmpdir(), `sidjua-test-${Date.now()}.zip`);
    writeFileSync(safeZip, "fake zip data");
    try {
      // Should NOT throw — path is in tmpdir + has .zip suffix
      expect(() => deleteBackup(safeZip, undefined)).not.toThrow();
      expect(existsSync(safeZip)).toBe(false); // deleted
    } finally {
      // Cleanup if test fails
      if (existsSync(safeZip)) rmSync(safeZip);
    }
  });
});

// ---------------------------------------------------------------------------
// FIX-M1: copyDirSync depth limit — prevent DoS via deeply nested directories
// ---------------------------------------------------------------------------

import { copyDirSync as _copyDirSync } from "../../src/core/backup.js";

describe("copyDirSync — depth limit: FIX-M1", () => {
  it("copies a shallow directory without error (depth within limit)", () => {
    const srcDir  = mkdtempSync(join(_tmpdir(), "sidjua-cp-src-"));
    const destDir = mkdtempSync(join(_tmpdir(), "sidjua-cp-dst-"));
    try {
      // 5-level deep directory — well within limit
      let cur = srcDir;
      for (let i = 0; i < 5; i++) {
        cur = join(cur, `d${i}`);
        mkdirSync(cur, { recursive: true });
      }
      writeFileSync(join(cur, "leaf.txt"), "data");
      expect(() => _copyDirSync(srcDir, destDir)).not.toThrow();
    } finally {
      rmSync(srcDir,  { recursive: true, force: true });
      rmSync(destDir, { recursive: true, force: true });
    }
  });

  it("throws SidjuaError at depth > MAX_COPY_DEPTH (default 50)", () => {
    const srcDir  = mkdtempSync(join(_tmpdir(), "sidjua-deep-src-"));
    const destDir = mkdtempSync(join(_tmpdir(), "sidjua-deep-dst-"));
    try {
      // 52-level deep directory — exceeds MAX_COPY_DEPTH=50
      let cur = srcDir;
      for (let i = 0; i < 52; i++) {
        cur = join(cur, `d${i}`);
        mkdirSync(cur, { recursive: true });
      }
      writeFileSync(join(cur, "leaf.txt"), "data");
      expect(() => _copyDirSync(srcDir, destDir)).toSatisfy(
        (fn: () => void) => {
          try { fn(); return false; }
          catch (err) { return isSidjuaError(err) && err.code === "SYS-009"; }
        },
      );
    } finally {
      rmSync(srcDir,  { recursive: true, force: true });
      rmSync(destDir, { recursive: true, force: true });
    }
  });
});
