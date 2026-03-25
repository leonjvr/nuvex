// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { wipeWorkspace } from "../../src/cli/commands/start-over.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  const dir = join(tmpdir(), `sidjua-wipe-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(path: string, content = "") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wipeWorkspace", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("removes governance directory", () => {
    mkdirSync(join(tmp, "governance"), { recursive: true });
    touch(join(tmp, "governance", "divisions.yaml"), "");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "governance"))).toBe(false);
  });

  it("removes agents directory", () => {
    touch(join(tmp, "agents", "definitions", "ceo.yaml"), "");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "agents"))).toBe(false);
  });

  it("removes .system directory (contains SQLite DB)", () => {
    touch(join(tmp, ".system", "sidjua.db"), "");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, ".system"))).toBe(false);
  });

  it("removes logs directory", () => {
    touch(join(tmp, "logs", "system.log"), "line1\nline2\n");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "logs"))).toBe(false);
  });

  it("removes chats directory", () => {
    touch(join(tmp, "chats", "conv-001.json"), "{}");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "chats"))).toBe(false);
  });

  it("removes user-files directory", () => {
    touch(join(tmp, "user-files", "report.pdf"), "pdf");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "user-files"))).toBe(false);
  });

  it("removes rules directory", () => {
    touch(join(tmp, "rules", "no-http.yaml"), "");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "rules"))).toBe(false);
  });

  it("removes .env file", () => {
    writeFileSync(join(tmp, ".env"), "GROQ_API_KEY=test\n");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, ".env"))).toBe(false);
  });

  it("removes root-level .db files", () => {
    writeFileSync(join(tmp, "legacy.db"), "");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "legacy.db"))).toBe(false);
  });

  it("removes root-level .sqlite files", () => {
    writeFileSync(join(tmp, "cache.sqlite"), "");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "cache.sqlite"))).toBe(false);
  });

  it("does NOT remove the backups directory (lives inside workspace if present)", () => {
    // If a user has placed a backups dir inside workspace, it should be preserved
    mkdirSync(join(tmp, "backups"), { recursive: true });
    touch(join(tmp, "backups", "workspace-2026-03-01-120000", "metadata.json"), "{}");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "backups"))).toBe(true);
  });

  it("removes division-specific root directories", () => {
    // Division dirs are created at workspace root by sidjua apply (executive/, engineering/, etc.)
    mkdirSync(join(tmp, "executive"), { recursive: true });
    mkdirSync(join(tmp, "engineering"), { recursive: true });
    touch(join(tmp, "engineering", "rbac.yaml"), "");
    wipeWorkspace(tmp);
    expect(existsSync(join(tmp, "executive"))).toBe(false);
    expect(existsSync(join(tmp, "engineering"))).toBe(false);
  });

  it("is idempotent on an already-empty workspace", () => {
    // Should not throw on missing directories
    expect(() => wipeWorkspace(tmp)).not.toThrow();
  });

  it("removes all governance and agent config, leaving nothing from old setup", () => {
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(join(tmp, "governance", "divisions.yaml"), "");
    touch(join(tmp, "governance", "rbac.yaml"), "");
    touch(join(tmp, "agents", "definitions", "ceo.yaml"), "");
    touch(join(tmp, "logs", "audit.log"), "");
    touch(join(tmp, "chats", "conv.json"), "{}");
    touch(join(tmp, "rules", "rule.yaml"), "");
    writeFileSync(join(tmp, ".env"), "KEY=value");

    wipeWorkspace(tmp);

    expect(existsSync(join(tmp, ".system"))).toBe(false);
    expect(existsSync(join(tmp, "governance"))).toBe(false);
    expect(existsSync(join(tmp, "agents"))).toBe(false);
    expect(existsSync(join(tmp, "logs"))).toBe(false);
    expect(existsSync(join(tmp, "chats"))).toBe(false);
    expect(existsSync(join(tmp, "rules"))).toBe(false);
    expect(existsSync(join(tmp, ".env"))).toBe(false);
  });
});
