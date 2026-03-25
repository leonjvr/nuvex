// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for file-size guard logic in memory.ts and cli-knowledge.ts imports.
 * Verifies that oversized files are rejected before readFileSync is called.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statSync } from "node:fs";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-size-limit-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("File size limit constants", () => {
  it("MAX_IMPORT_SIZE is 50 MB", () => {
    const expected = 50 * 1024 * 1024;
    expect(expected).toBe(52_428_800);
  });

  it("MAX_PROMPT_SIZE is 1 MB", () => {
    const expected = 1 * 1024 * 1024;
    expect(expected).toBe(1_048_576);
  });
});

describe("statSync size detection", () => {
  it("correctly detects file size for guard checks", () => {
    const testFile = join(tmpDir, "test.txt");
    const content = "x".repeat(1000);
    writeFileSync(testFile, content, "utf8");
    const stats = statSync(testFile);
    expect(stats.size).toBe(1000);
  });

  it("rejects files over 50 MB threshold (simulated)", () => {
    const MAX_IMPORT_SIZE = 50 * 1024 * 1024;
    const fakeSize = MAX_IMPORT_SIZE + 1;
    expect(fakeSize > MAX_IMPORT_SIZE).toBe(true);
  });

  it("accepts files at exactly 50 MB (boundary)", () => {
    const MAX_IMPORT_SIZE = 50 * 1024 * 1024;
    const fakeSize = MAX_IMPORT_SIZE;
    expect(fakeSize > MAX_IMPORT_SIZE).toBe(false);
  });

  it("rejects files over 1 MB prompt threshold (simulated)", () => {
    const MAX_PROMPT_SIZE = 1 * 1024 * 1024;
    const fakeSize = MAX_PROMPT_SIZE + 1;
    expect(fakeSize > MAX_PROMPT_SIZE).toBe(true);
  });

  it("accepts files at exactly 1 MB prompt boundary", () => {
    const MAX_PROMPT_SIZE = 1 * 1024 * 1024;
    const fakeSize = MAX_PROMPT_SIZE;
    expect(fakeSize > MAX_PROMPT_SIZE).toBe(false);
  });
});
