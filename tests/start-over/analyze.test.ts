// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  runAnalyzeCommand,
  readBackupMetadata,
  type BackupMetadata,
} from "../../src/cli/commands/start-over.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  const dir = join(tmpdir(), `sidjua-analyze-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(path: string, content = "") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function validMeta(overrides: Partial<BackupMetadata> = {}): BackupMetadata {
  return {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readBackupMetadata
// ---------------------------------------------------------------------------

describe("readBackupMetadata", () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns null for missing path", () => {
    expect(readBackupMetadata(join(dir, "nonexistent"))).toBeNull();
  });

  it("returns null for directory without metadata.json", () => {
    expect(readBackupMetadata(dir)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    writeFileSync(join(dir, "metadata.json"), "not json", "utf8");
    expect(readBackupMetadata(dir)).toBeNull();
  });

  it("reads all required fields", () => {
    const meta = validMeta();
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta), "utf8");
    const result = readBackupMetadata(dir);
    expect(result).not.toBeNull();
    expect(result!.sidjua_version).toBe("0.11.0");
    expect(result!.agent_count).toBe(4);
    expect(result!.division_count).toBe(3);
    expect(result!.chat_count).toBe(23);
    expect(result!.reason).toBe("start-over");
  });
});

// ---------------------------------------------------------------------------
// runAnalyzeCommand — validation
// ---------------------------------------------------------------------------

describe("runAnalyzeCommand — validation", () => {
  let dir: string;
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  beforeEach(() => {
    dir = mkTmp();
    stderrSpy.mockClear();
    stdoutSpy.mockClear();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 1 for non-existent workspace path", async () => {
    const code = await runAnalyzeCommand({ workspace: join(dir, "nonexistent") });
    expect(code).toBe(1);
    const errOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(errOutput).toContain("not found");
  });

  it("returns 1 for path without metadata.json", async () => {
    const code = await runAnalyzeCommand({ workspace: dir });
    expect(code).toBe(1);
    const errOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(errOutput).toContain("metadata.json");
  });

  it("displays workspace summary with correct counts", async () => {
    const meta = validMeta({ agent_count: 4, division_count: 3, chat_count: 23 });
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta), "utf8");

    const code = await runAnalyzeCommand({ workspace: dir });
    expect(code).toBe(0);

    const out = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(out).toContain("0.11.0");
    expect(out).toContain("4");
    expect(out).toContain("3");
    expect(out).toContain("23");
  });

  it("shows fallback message when no auditor configured", async () => {
    const meta = validMeta();
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta), "utf8");

    const code = await runAnalyzeCommand({ workspace: dir });
    expect(code).toBe(0);

    const out = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    // Should contain the fallback guidance since no auditor is in cwd
    expect(out).toContain("auditor");
  });

  it("shows the backup path in the fallback message", async () => {
    const meta = validMeta();
    writeFileSync(join(dir, "metadata.json"), JSON.stringify(meta), "utf8");

    await runAnalyzeCommand({ workspace: dir });

    const out = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(out).toContain(dir);
  });
});
