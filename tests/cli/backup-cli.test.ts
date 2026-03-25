/**
 * Tests for src/cli/cli-backup.ts — Phase 10.9 Backup CLI commands
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerBackupCommands } from "../../src/cli/cli-backup.js";
import { createBackup, getBackupConfig } from "../../src/core/backup.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureOutput(): { getStdout: () => string; getStderr: () => string; restore: () => void } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: unknown) => { outChunks.push(String(chunk)); return true; };
  process.stderr.write = (chunk: unknown) => { errChunks.push(String(chunk)); return true; };
  return {
    getStdout: () => outChunks.join(""),
    getStderr: () => errChunks.join(""),
    restore:   () => { process.stdout.write = origOut; process.stderr.write = origErr; },
  };
}

let workDir: string;
let configPath: string;
let backupDir: string;

function makeWorkspace(): void {
  workDir   = mkdtempSync(join(tmpdir(), "sidjua-backup-cli-test-"));
  backupDir = join(workDir, "data", "backups");
  mkdirSync(backupDir, { recursive: true });
  configPath = join(workDir, "divisions.yaml");
  writeFileSync(
    configPath,
    "schema_version: '1.0'\ncompany:\n  name: TestCo\ndivisions: []\n",
    "utf-8",
  );
  mkdirSync(join(workDir, "governance"), { recursive: true });
  writeFileSync(join(workDir, "governance", "rules.json"), '{"rules":[]}', "utf-8");
}

let program: Command;

beforeEach(() => {
  makeWorkspace();
  program = new Command();
  program.exitOverride();
  registerBackupCommands(program);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// backup list (empty)
// ---------------------------------------------------------------------------

describe("backup list", () => {
  it("shows 'No backups found' when backup directory is empty", async () => {
    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["backup", "list", "--work-dir", workDir, "--config", configPath],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    expect(cap.getStdout()).toContain("No backups found");
  });

  it("shows a table header when backups exist", async () => {
    const cfg = getBackupConfig(workDir, configPath);
    await createBackup({ workDir, configPath, label: "test" }, cfg);

    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["backup", "list", "--work-dir", workDir, "--config", configPath],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    const out = cap.getStdout();
    expect(out).toContain("ID");
    expect(out).toContain("DATE");
    expect(out).toContain("SIZE");
    expect(out).toContain("test");
  });
});

// ---------------------------------------------------------------------------
// backup create
// ---------------------------------------------------------------------------

describe("backup create", () => {
  it("creates an archive and prints success info", async () => {
    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["backup", "create", "--work-dir", workDir, "--config", configPath],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    const out = cap.getStdout();
    expect(out).toContain("Backup created successfully");
    expect(out).toContain("ID:");
    expect(out).toContain("Archive:");
    expect(out).toContain("Files:");
  });

  it("prints the label when --label is provided", async () => {
    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["backup", "create", "--work-dir", workDir, "--config", configPath, "--label", "mybackup"],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    expect(cap.getStdout()).toContain("mybackup");
  });

  it("writes archive to --output path", async () => {
    const customPath = join(workDir, "my-custom.tar.gz");
    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["backup", "create", "--work-dir", workDir, "--config", configPath, "--output", customPath],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    expect(existsSync(customPath)).toBe(true);
    expect(cap.getStdout()).toContain("my-custom.tar.gz");
  });
});

// ---------------------------------------------------------------------------
// backup info
// ---------------------------------------------------------------------------

describe("backup info", () => {
  it("prints manifest details for a known archive", async () => {
    const cfg     = getBackupConfig(workDir, configPath);
    const created = await createBackup({ workDir, configPath, label: "info-test" }, cfg);

    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["backup", "info", created.archive_path, "--work-dir", workDir, "--config", configPath],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    const out = cap.getStdout();
    expect(out).toContain("Full ID:");
    expect(out).toContain("Files:");
    expect(out).toContain("Checksum:");
    expect(out).toContain("info-test");
  });
});

// ---------------------------------------------------------------------------
// backup restore
// ---------------------------------------------------------------------------

describe("backup restore", () => {
  it("--dry-run prints validation message without modifying files", async () => {
    const cfg     = getBackupConfig(workDir, configPath);
    const created = await createBackup({ workDir, configPath }, cfg);

    const cap = captureOutput();
    try {
      await program.parseAsync(
        [
          "backup", "restore", created.archive_path,
          "--dry-run",
          "--work-dir", workDir, "--config", configPath,
        ],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    const out = cap.getStdout();
    expect(out).toContain("Dry-run");
    expect(out).toContain("valid");
  });

  it("without --force prints confirmation message and exits 0", async () => {
    const cfg     = getBackupConfig(workDir, configPath);
    const created = await createBackup({ workDir, configPath }, cfg);

    const mockExit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    const cap = captureOutput();
    try {
      await program.parseAsync(
        [
          "backup", "restore", created.archive_path,
          "--work-dir", workDir, "--config", configPath,
        ],
        { from: "user" },
      );
    } catch {
      // expected exit
    } finally {
      cap.restore();
      mockExit.mockRestore();
    }
    const out = cap.getStdout();
    expect(out).toContain("About to restore");
    expect(out).toContain("--force");
  });

  it("--force performs a real restore", async () => {
    const cfg     = getBackupConfig(workDir, configPath);
    const created = await createBackup({ workDir, configPath }, cfg);

    // Overwrite the governance file
    writeFileSync(join(workDir, "governance", "rules.json"), '{"MODIFIED":true}', "utf-8");

    const cap = captureOutput();
    try {
      await program.parseAsync(
        [
          "backup", "restore", created.archive_path,
          "--force",
          "--work-dir", workDir, "--config", configPath,
        ],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    const out = cap.getStdout();
    expect(out).toContain("Restore complete");
    expect(out).toContain("Files restored:");
  });
});

// ---------------------------------------------------------------------------
// backup delete
// ---------------------------------------------------------------------------

describe("backup delete", () => {
  it("without --force prints confirmation message", async () => {
    const cfg     = getBackupConfig(workDir, configPath);
    const created = await createBackup({ workDir, configPath }, cfg);

    const mockExit = vi.spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });

    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["backup", "delete", created.short_id, "--work-dir", workDir, "--config", configPath],
        { from: "user" },
      );
    } catch {
      // expected exit
    } finally {
      cap.restore();
      mockExit.mockRestore();
    }
    expect(cap.getStdout()).toContain("--force");
  });

  it("--force deletes the backup archive", async () => {
    const cfg     = getBackupConfig(workDir, configPath);
    const created = await createBackup({ workDir, configPath }, cfg);

    const cap = captureOutput();
    try {
      await program.parseAsync(
        [
          "backup", "delete", created.archive_path,
          "--force",
          "--work-dir", workDir, "--config", configPath,
        ],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    expect(cap.getStdout()).toContain("deleted");
    expect(existsSync(created.archive_path)).toBe(false);
  });
});
