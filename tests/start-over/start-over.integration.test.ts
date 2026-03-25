// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  runStartOverCommand,
  scanWorkspace,
  createWorkspaceBackup,
  wipeWorkspace,
  listBackups,
  type BackupMetadata,
} from "../../src/cli/commands/start-over.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  const dir = join(tmpdir(), `sidjua-integration-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(path: string, content = "") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** Build a minimal initialised workspace (no real SQLite needed) */
function buildWorkspace(dir: string) {
  touch(join(dir, ".system", "sidjua.db"), "SQLite format 3\x00");
  touch(join(dir, "governance", "divisions.yaml"), "divisions:\n  - name: executive\n    code: exec\n");
  touch(join(dir, "agents", "definitions", "ceo-assistant.yaml"), "name: ceo-assistant\n");
  touch(join(dir, "agents", "definitions", "guide.yaml"), "name: guide\n");
  touch(join(dir, "logs", "audit.log"), "event1\nevent2\nevent3\n");
  touch(join(dir, "chats", "conv-001.json"), "{}");
  touch(join(dir, "user-files", "report.pdf"), "pdf");
  touch(join(dir, "rules", "no-external.yaml"), "allow: []\n");
  writeFileSync(join(dir, ".env"), "GROQ_API_KEY=test\n");
}

// ---------------------------------------------------------------------------
// Integration: scan → backup
// ---------------------------------------------------------------------------

describe("scan then backup", () => {
  let workDir: string;
  let backupsRoot: string;
  const now = new Date("2026-03-18T14:22:15.000Z");

  beforeEach(() => {
    workDir     = mkTmp();
    backupsRoot = mkTmp();
    buildWorkspace(workDir);
  });
  afterEach(() => {
    rmSync(workDir,     { recursive: true, force: true });
    rmSync(backupsRoot, { recursive: true, force: true });
  });

  it("full flow: scan returns correct counts, backup creates complete copy", () => {
    const summary = scanWorkspace(workDir);
    expect(summary.isInitialized).toBe(true);
    expect(summary.agentCount).toBe(2);
    expect(summary.chatHistories).toBe(1);
    expect(summary.userFiles).toBe(1);
    expect(summary.governanceRules).toBe(1);

    const dest = createWorkspaceBackup(workDir, summary, backupsRoot, now);
    expect(existsSync(join(dest, ".system", "sidjua.db"))).toBe(true);
    expect(existsSync(join(dest, "governance", "divisions.yaml"))).toBe(true);
    expect(existsSync(join(dest, "agents", "definitions", "ceo-assistant.yaml"))).toBe(true);
    expect(existsSync(join(dest, "logs", "audit.log"))).toBe(true);
    expect(existsSync(join(dest, "chats", "conv-001.json"))).toBe(true);
    expect(existsSync(join(dest, "user-files", "report.pdf"))).toBe(true);
    expect(existsSync(join(dest, "rules", "no-external.yaml"))).toBe(true);
    expect(existsSync(join(dest, ".env"))).toBe(true);
    expect(existsSync(join(dest, "metadata.json"))).toBe(true);
  });

  it("backup followed by wipe leaves workspace empty of setup files", () => {
    const summary = scanWorkspace(workDir);
    createWorkspaceBackup(workDir, summary, backupsRoot, now);
    wipeWorkspace(workDir);

    // All workspace state removed
    expect(existsSync(join(workDir, ".system"))).toBe(false);
    expect(existsSync(join(workDir, "governance"))).toBe(false);
    expect(existsSync(join(workDir, "agents"))).toBe(false);
    expect(existsSync(join(workDir, "logs"))).toBe(false);
    expect(existsSync(join(workDir, ".env"))).toBe(false);

    // Backup is preserved (lives in backupsRoot, outside workDir)
    expect(existsSync(backupsRoot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: multiple start-overs
// ---------------------------------------------------------------------------

describe("multiple start-overs", () => {
  let workDir: string;
  let backupsRoot: string;

  beforeEach(() => {
    workDir     = mkTmp();
    backupsRoot = mkTmp();
    buildWorkspace(workDir);
  });
  afterEach(() => {
    rmSync(workDir,     { recursive: true, force: true });
    rmSync(backupsRoot, { recursive: true, force: true });
  });

  it("each backup is independent and preserved", () => {
    const summary = scanWorkspace(workDir);
    const d1 = createWorkspaceBackup(workDir, summary, backupsRoot, new Date("2026-03-18T10:00:00Z"));
    const d2 = createWorkspaceBackup(workDir, summary, backupsRoot, new Date("2026-03-18T11:00:00Z"));
    const d3 = createWorkspaceBackup(workDir, summary, backupsRoot, new Date("2026-03-18T12:00:00Z"));

    expect(d1).not.toBe(d2);
    expect(d2).not.toBe(d3);
    expect(existsSync(d1)).toBe(true);
    expect(existsSync(d2)).toBe(true);
    expect(existsSync(d3)).toBe(true);
  });

  it("listBackups shows all backups, none auto-deleted", () => {
    const summary = scanWorkspace(workDir);
    createWorkspaceBackup(workDir, summary, backupsRoot, new Date("2026-03-15T10:00:00Z"));
    createWorkspaceBackup(workDir, summary, backupsRoot, new Date("2026-03-17T10:00:00Z"));
    createWorkspaceBackup(workDir, summary, backupsRoot, new Date("2026-03-18T10:00:00Z"));

    const entries = listBackups(backupsRoot);
    expect(entries.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// runStartOverCommand — abort at confirmation
// ---------------------------------------------------------------------------

describe("runStartOverCommand — abort", () => {
  let workDir: string;
  let backupsRoot: string;
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  beforeEach(() => {
    workDir     = mkTmp();
    backupsRoot = mkTmp();
    buildWorkspace(workDir);
    stdoutSpy.mockClear();
    stderrSpy.mockClear();
  });
  afterEach(() => {
    rmSync(workDir,     { recursive: true, force: true });
    rmSync(backupsRoot, { recursive: true, force: true });
  });

  it("abort at confirmation: backup exists, workspace unchanged", async () => {
    const code = await runStartOverCommand({
      workDir,
      list:        false,
      backupsRoot,
      forceYes:    false, // simulate user pressing N
    });

    expect(code).toBe(0);

    // Workspace still intact
    expect(existsSync(join(workDir, ".system", "sidjua.db"))).toBe(true);
    expect(existsSync(join(workDir, "governance"))).toBe(true);

    // Backup was still created (backup happens before confirmation)
    const entries = listBackups(backupsRoot);
    expect(entries.length).toBe(1);

    const out = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(out).toContain("Cancelled");
  });
});

// ---------------------------------------------------------------------------
// runStartOverCommand — empty workspace
// ---------------------------------------------------------------------------

describe("runStartOverCommand — edge cases", () => {
  let workDir: string;
  let backupsRoot: string;
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  beforeEach(() => {
    workDir     = mkTmp();
    backupsRoot = mkTmp();
    stderrSpy.mockClear();
    stdoutSpy.mockClear();
  });
  afterEach(() => {
    rmSync(workDir,     { recursive: true, force: true });
    rmSync(backupsRoot, { recursive: true, force: true });
  });

  it("empty workspace: returns 1 with informative message", async () => {
    const code = await runStartOverCommand({
      workDir,
      list:        false,
      backupsRoot,
      forceYes:    false,
    });
    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(err).toContain("empty");
  });

  it("--list on empty backups root shows 'No previous backups'", async () => {
    const code = await runStartOverCommand({
      workDir,
      list:        true,
      backupsRoot,
      forceYes:    false,
    });
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(out).toContain("No previous backups");
  });

  it("--list shows backed-up workspaces", async () => {
    buildWorkspace(workDir);
    const summary = scanWorkspace(workDir);
    createWorkspaceBackup(workDir, summary, backupsRoot, new Date("2026-03-18T14:00:00Z"));

    const code = await runStartOverCommand({
      workDir,
      list:        true,
      backupsRoot,
      forceYes:    false,
    });
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(out).toContain("workspace-");
  });

  it("uninitialized (has files but no DB): returns 1", async () => {
    mkdirSync(join(workDir, ".system"), { recursive: true });
    // No sidjua.db
    touch(join(workDir, "governance", "divisions.yaml"), "");

    const code = await runStartOverCommand({
      workDir,
      list:        false,
      backupsRoot,
      forceYes:    false,
    });
    expect(code).toBe(1);
    const err = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(err).toContain("sidjua init");
  });
});
