// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  formatBackupTimestamp,
  resolveBackupDest,
  createWorkspaceBackup,
  writeBackupMetadata,
  listBackups,
  readBackupMetadata,
  type WorkspaceSummary,
  type BackupMetadata,
} from "../../src/cli/commands/start-over.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  const dir = join(tmpdir(), `sidjua-backup-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(path: string, content = "") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function makeSummary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    workDir:         "/tmp/test-workspace",
    created:         new Date("2026-03-10T14:22:00Z"),
    agentCount:      4,
    activeAgents:    2,
    stoppedAgents:   1,
    errorAgents:     1,
    divisionCount:   3,
    logEntries:      1247,
    configFiles:     8,
    sqliteDbs:       4,
    chatHistories:   23,
    userFiles:       15,
    governanceRules: 12,
    totalBytes:      12910592,
    isEmpty:         false,
    isInitialized:   true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatBackupTimestamp
// ---------------------------------------------------------------------------

describe("formatBackupTimestamp", () => {
  it("formats correctly: YYYY-MM-DD-HHmmss", () => {
    const d = new Date("2026-03-18T14:22:15.000Z");
    // Use local time — convert to match local offset
    const result = formatBackupTimestamp(d);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  });

  it("pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5, 9, 3, 7); // Jan 5, 09:03:07 local
    const result = formatBackupTimestamp(d);
    expect(result).toMatch(/^2026-01-05-090307$/);
  });
});

// ---------------------------------------------------------------------------
// resolveBackupDest
// ---------------------------------------------------------------------------

describe("resolveBackupDest", () => {
  let root: string;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("returns base path if it does not exist", () => {
    const dest = resolveBackupDest(root, "2026-03-18-142215");
    expect(dest).toBe(join(root, "workspace-2026-03-18-142215"));
  });

  it("appends -1 if base exists", () => {
    mkdirSync(join(root, "workspace-2026-03-18-142215"), { recursive: true });
    const dest = resolveBackupDest(root, "2026-03-18-142215");
    expect(dest).toBe(join(root, "workspace-2026-03-18-142215-1"));
  });

  it("appends -2 if both base and -1 exist", () => {
    mkdirSync(join(root, "workspace-2026-03-18-142215"), { recursive: true });
    mkdirSync(join(root, "workspace-2026-03-18-142215-1"), { recursive: true });
    const dest = resolveBackupDest(root, "2026-03-18-142215");
    expect(dest).toBe(join(root, "workspace-2026-03-18-142215-2"));
  });
});

// ---------------------------------------------------------------------------
// writeBackupMetadata
// ---------------------------------------------------------------------------

describe("writeBackupMetadata", () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writes parseable metadata.json with all required fields", () => {
    const meta: BackupMetadata = {
      backup_date:       "2026-03-18T14:22:15.000Z",
      sidjua_version:    "0.11.0",
      workspace_created: "2026-03-10T14:22:00.000Z",
      agent_count:       4,
      division_count:    3,
      chat_count:        23,
      file_count:        15,
      rule_count:        12,
      total_size_bytes:  12910592,
      reason:            "start-over",
    };
    writeBackupMetadata(dir, meta);

    const parsed = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as BackupMetadata;
    expect(parsed.backup_date).toBe(meta.backup_date);
    expect(parsed.sidjua_version).toBe(meta.sidjua_version);
    expect(parsed.agent_count).toBe(4);
    expect(parsed.division_count).toBe(3);
    expect(parsed.chat_count).toBe(23);
    expect(parsed.file_count).toBe(15);
    expect(parsed.rule_count).toBe(12);
    expect(parsed.total_size_bytes).toBe(12910592);
    expect(parsed.reason).toBe("start-over");
  });
});

// ---------------------------------------------------------------------------
// createWorkspaceBackup
// ---------------------------------------------------------------------------

describe("createWorkspaceBackup", () => {
  let workDir: string;
  let backupsRoot: string;
  const now = new Date("2026-03-18T14:22:15.000Z");

  beforeEach(() => {
    workDir     = mkTmp();
    backupsRoot = mkTmp();
  });
  afterEach(() => {
    rmSync(workDir,     { recursive: true, force: true });
    rmSync(backupsRoot, { recursive: true, force: true });
  });

  it("copies workspace to timestamped directory under backupsRoot", () => {
    touch(join(workDir, ".system", "sidjua.db"), "db");
    touch(join(workDir, "governance", "divisions.yaml"), "divisions:\n");
    touch(join(workDir, "agents", "definitions", "ceo.yaml"), "name: ceo\n");

    const dest = createWorkspaceBackup(workDir, makeSummary({ workDir }), backupsRoot, now);

    expect(existsSync(dest)).toBe(true);
    expect(existsSync(join(dest, ".system", "sidjua.db"))).toBe(true);
    expect(existsSync(join(dest, "governance", "divisions.yaml"))).toBe(true);
    expect(existsSync(join(dest, "agents", "definitions", "ceo.yaml"))).toBe(true);
  });

  it("backup includes metadata.json with correct fields", () => {
    touch(join(workDir, ".system", "sidjua.db"), "db");
    const summary = makeSummary({ workDir, agentCount: 4, divisionCount: 3, chatHistories: 23 });

    const dest = createWorkspaceBackup(workDir, summary, backupsRoot, now);

    const meta = JSON.parse(readFileSync(join(dest, "metadata.json"), "utf8")) as BackupMetadata;
    expect(meta.agent_count).toBe(4);
    expect(meta.division_count).toBe(3);
    expect(meta.chat_count).toBe(23);
    expect(meta.reason).toBe("start-over");
    expect(meta.sidjua_version).toBeTruthy();
  });

  it("backup destination path uses correct timestamp format", () => {
    const dest = createWorkspaceBackup(workDir, makeSummary({ workDir }), backupsRoot, now);
    expect(basename(dest)).toMatch(/^workspace-\d{4}-\d{2}-\d{2}-\d{6}(-\d+)?$/);
  });

  it("handles same-second collision by appending -1", () => {
    touch(join(workDir, ".system", "sidjua.db"), "db");
    const dest1 = createWorkspaceBackup(workDir, makeSummary({ workDir }), backupsRoot, now);
    const dest2 = createWorkspaceBackup(workDir, makeSummary({ workDir }), backupsRoot, now);

    expect(dest1).not.toBe(dest2);
    expect(existsSync(dest1)).toBe(true);
    expect(existsSync(dest2)).toBe(true);
  });

  it("backups chats and user-files directories", () => {
    touch(join(workDir, ".system", "sidjua.db"), "db");
    touch(join(workDir, "chats", "conv-001.json"), "{}");
    touch(join(workDir, "user-files", "report.pdf"), "pdf");

    const dest = createWorkspaceBackup(workDir, makeSummary({ workDir }), backupsRoot, now);

    expect(existsSync(join(dest, "chats", "conv-001.json"))).toBe(true);
    expect(existsSync(join(dest, "user-files", "report.pdf"))).toBe(true);
  });

  it("backups governance rules directory", () => {
    touch(join(workDir, ".system", "sidjua.db"), "db");
    touch(join(workDir, "rules", "no-http.yaml"), "rule: deny\n");
    touch(join(workDir, "governance", "boundaries", "defaults.yaml"), "allow: []\n");

    const dest = createWorkspaceBackup(workDir, makeSummary({ workDir }), backupsRoot, now);

    expect(existsSync(join(dest, "rules", "no-http.yaml"))).toBe(true);
    expect(existsSync(join(dest, "governance", "boundaries", "defaults.yaml"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readBackupMetadata
// ---------------------------------------------------------------------------

describe("readBackupMetadata", () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns null for non-existent path", () => {
    expect(readBackupMetadata(join(dir, "nonexistent"))).toBeNull();
  });

  it("returns null when metadata.json is absent", () => {
    expect(readBackupMetadata(dir)).toBeNull();
  });

  it("returns null when metadata.json is invalid JSON", () => {
    writeFileSync(join(dir, "metadata.json"), "not json{{{", "utf8");
    expect(readBackupMetadata(dir)).toBeNull();
  });

  it("returns parsed metadata when valid", () => {
    const meta: BackupMetadata = {
      backup_date:       "2026-03-18T14:22:15.000Z",
      sidjua_version:    "0.11.0",
      workspace_created: null,
      agent_count:       2,
      division_count:    1,
      chat_count:        0,
      file_count:        0,
      rule_count:        0,
      total_size_bytes:  1024,
      reason:            "start-over",
    };
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta), "utf8");
    const result = readBackupMetadata(dir);
    expect(result).not.toBeNull();
    expect(result!.sidjua_version).toBe("0.11.0");
    expect(result!.agent_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// listBackups
// ---------------------------------------------------------------------------

describe("listBackups", () => {
  let root: string;
  beforeEach(() => { root = mkTmp(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("returns empty array when backups root does not exist", () => {
    expect(listBackups(join(root, "nonexistent"))).toEqual([]);
  });

  it("returns empty array when backups root is empty", () => {
    expect(listBackups(root)).toEqual([]);
  });

  it("lists backups with metadata", () => {
    const b1 = join(root, "workspace-2026-03-15-100000");
    const b2 = join(root, "workspace-2026-03-18-142215");
    mkdirSync(b1); mkdirSync(b2);

    const meta: BackupMetadata = {
      backup_date: "2026-03-18T14:22:15.000Z",
      sidjua_version: "0.11.0",
      workspace_created: null,
      agent_count: 1,
      division_count: 1,
      chat_count: 0,
      file_count: 0,
      rule_count: 0,
      total_size_bytes: 0,
      reason: "start-over",
    };
    writeFileSync(join(b2, "metadata.json"), JSON.stringify(meta), "utf8");

    const entries = listBackups(root);
    expect(entries.length).toBe(2);
    // Sorted reverse — newest first
    expect(entries[0]!.name).toBe("workspace-2026-03-18-142215");
    expect(entries[0]!.meta?.sidjua_version).toBe("0.11.0");
    expect(entries[1]!.meta).toBeNull();
  });

  it("shows all backups independently without auto-deletion", () => {
    for (let i = 1; i <= 5; i++) {
      mkdirSync(join(root, `workspace-2026-03-0${i}-120000`));
    }
    const entries = listBackups(root);
    expect(entries.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}
