// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { scanWorkspace } from "../../src/cli/commands/start-over.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  const dir = join(tmpdir(), `sidjua-scan-test-${randomUUID()}`);
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

describe("scanWorkspace", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkTmp(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("empty workspace: isEmpty=true, isInitialized=false", () => {
    const s = scanWorkspace(tmp);
    expect(s.isEmpty).toBe(true);
    expect(s.isInitialized).toBe(false);
    expect(s.agentCount).toBe(0);
    expect(s.divisionCount).toBe(0);
  });

  it("workspace with .system dir but no DB: isEmpty=false, isInitialized=false", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "providers", "groq.yaml"), "provider: groq\n");
    const s = scanWorkspace(tmp);
    expect(s.isEmpty).toBe(false);
    expect(s.isInitialized).toBe(false);
  });

  it("counts agent definitions correctly", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), ""); // mock DB presence
    const defsDir = join(tmp, "agents", "definitions");
    touch(join(defsDir, "ceo-assistant.yaml"), "name: ceo-assistant\n");
    touch(join(defsDir, "guide.yaml"), "name: guide\n");
    touch(join(defsDir, "auditor.yaml"), "name: auditor\n");
    touch(join(defsDir, "README.md"), "# docs"); // should not count

    const s = scanWorkspace(tmp);
    expect(s.agentCount).toBe(3);
  });

  it("counts divisions from governance/divisions.yaml", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(
      join(tmp, "governance", "divisions.yaml"),
      `divisions:\n  - name: executive\n    code: exec\n  - name: engineering\n    code: eng\n  - name: hr\n    code: hr\n`,
    );
    const s = scanWorkspace(tmp);
    expect(s.divisionCount).toBe(3);
  });

  it("counts log entries from .log files", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(
      join(tmp, "logs", "system.log"),
      "line1\nline2\nline3\n",
    );
    touch(
      join(tmp, "logs", "audit.log"),
      "entry1\nentry2\n",
    );
    const s = scanWorkspace(tmp);
    expect(s.logEntries).toBe(5);
  });

  it("counts config files in governance and .system/providers", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(join(tmp, "governance", "divisions.yaml"), "");
    touch(join(tmp, "governance", "orchestrator.yaml"), "");
    touch(join(tmp, "governance", "CHARTER.md"), ""); // not counted (not yaml/json)
    touch(join(tmp, ".system", "providers", "groq.yaml"), "");
    touch(join(tmp, ".system", "providers", "google.yaml"), "");

    const s = scanWorkspace(tmp);
    expect(s.configFiles).toBeGreaterThanOrEqual(4); // 2 gov + 2 providers
  });

  it("counts SQLite databases", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(join(tmp, ".system", "knowledge.db"), "");
    touch(join(tmp, "telemetry.sqlite"), "");

    const s = scanWorkspace(tmp);
    expect(s.sqliteDbs).toBe(3);
  });

  it("counts chat histories from chats directory", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(join(tmp, "chats", "conv-001.json"), "{}");
    touch(join(tmp, "chats", "conv-002.json"), "{}");
    touch(join(tmp, "chats", "conv-003.json"), "{}");

    const s = scanWorkspace(tmp);
    expect(s.chatHistories).toBe(3);
  });

  it("counts user files from user-files directory", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(join(tmp, "user-files", "report.pdf"), "pdf");
    touch(join(tmp, "user-files", "data.csv"), "csv");

    const s = scanWorkspace(tmp);
    expect(s.userFiles).toBe(2);
  });

  it("counts governance rules from rules/ and governance/boundaries/", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(join(tmp, "rules", "no-external-http.yaml"), "");
    touch(join(tmp, "rules", "data-classification.yaml"), "");
    touch(join(tmp, "governance", "boundaries", "defaults.yaml"), "");

    const s = scanWorkspace(tmp);
    expect(s.governanceRules).toBe(3);
  });

  it("totalBytes accumulates all file sizes", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");
    touch(join(tmp, "agents", "definitions", "agent.yaml"), "x".repeat(100));
    const s = scanWorkspace(tmp);
    expect(s.totalBytes).toBeGreaterThan(0);
  });

  it("handles unreadable directories gracefully", () => {
    // non-existent workspace — should not throw
    const s = scanWorkspace(join(tmp, "nonexistent"));
    expect(s.isEmpty).toBe(true);
    expect(s.agentCount).toBe(0);
  });

  it("isInitialized=true when .system/sidjua.db exists", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "SQLite format 3");

    const s = scanWorkspace(tmp);
    expect(s.isInitialized).toBe(true);
    expect(s.isEmpty).toBe(false);
  });

  it("zero counts for missing optional directories", () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    touch(join(tmp, ".system", "sidjua.db"), "");

    const s = scanWorkspace(tmp);
    expect(s.logEntries).toBe(0);
    expect(s.chatHistories).toBe(0);
    expect(s.userFiles).toBe(0);
    expect(s.governanceRules).toBe(0);
  });
});
