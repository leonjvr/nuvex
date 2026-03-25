// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/paths.ts — SidjuaPaths resolver.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir }                               from "node:os";
import { join, resolve }                                 from "node:path";
import {
  resolvePaths,
  findDataDir,
  validatePaths,
  resetPathsSingleton,
  getPaths,
}                                                        from "../../src/core/paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-paths-test-"));
}

// ---------------------------------------------------------------------------
// resolvePaths
// ---------------------------------------------------------------------------

describe("resolvePaths", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env["SIDJUA_DATA_DIR"];
    delete process.env["SIDJUA_DATA_DIR"];
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env["SIDJUA_DATA_DIR"] = savedEnv;
    } else {
      delete process.env["SIDJUA_DATA_DIR"];
    }
  });

  it("returns SidjuaPaths with system and data properties", () => {
    const paths = resolvePaths("/tmp/test-data");
    expect(paths).toHaveProperty("system");
    expect(paths).toHaveProperty("data");
  });

  it("system root resolves to the package system/ directory", () => {
    const paths = resolvePaths("/tmp/test-data");
    expect(paths.system.root).toContain("system");
    expect(paths.system.root).toMatch(/sidjua[/\\]system$/);
  });

  it("system paths are subdirectories of system root", () => {
    const paths = resolvePaths("/tmp/test-data");
    expect(paths.system.schemas).toBe(join(paths.system.root, "schemas"));
    expect(paths.system.governance).toBe(join(paths.system.root, "governance"));
    expect(paths.system.migrations).toBe(join(paths.system.root, "migrations"));
    expect(paths.system.templates).toBe(join(paths.system.root, "templates"));
    expect(paths.system.version).toBe(join(paths.system.root, "VERSION"));
  });

  it("explicit dataDir argument takes highest priority", () => {
    process.env["SIDJUA_DATA_DIR"] = "/from/env";
    const paths = resolvePaths("/explicit/data");
    expect(paths.data.root).toBe("/explicit/data");
  });

  it("SIDJUA_DATA_DIR env var used when no explicit arg", () => {
    process.env["SIDJUA_DATA_DIR"] = "/from/env-var";
    const paths = resolvePaths();
    expect(paths.data.root).toBe("/from/env-var");
  });

  it("data paths are subdirectories of data root", () => {
    const paths = resolvePaths("/my/data");
    expect(paths.data.config).toBe("/my/data/config");
    expect(paths.data.governance).toBe("/my/data/governance");
    expect(paths.data.divisions).toBe("/my/data/divisions");
    expect(paths.data.secrets).toBe("/my/data/secrets");
    expect(paths.data.backups).toBe("/my/data/backups");
    expect(paths.data.migrationState).toBe("/my/data/.migration-state.json");
  });

  it("falls back to ~/.sidjua/ when no env var and no config file found", () => {
    // Use a temp dir as cwd so findDataDir finds nothing
    const orig = process.cwd();
    const tmp  = makeTempDir();
    process.chdir(tmp);
    try {
      const paths = resolvePaths();
      expect(paths.data.root).toBe(join(homedir(), ".sidjua"));
    } finally {
      process.chdir(orig);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// findDataDir
// ---------------------------------------------------------------------------

describe("findDataDir", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTempDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no sidjua.config.json found", () => {
    const result = findDataDir(tmp);
    expect(result).toBeNull();
  });

  it("finds sidjua.config.json in the start directory", () => {
    const dataDir = join(tmp, "my-data");
    writeFileSync(join(tmp, "sidjua.config.json"), JSON.stringify({ dataDir }));
    const result = findDataDir(tmp);
    expect(result).toBe(resolve(tmp, dataDir));
  });

  it("finds sidjua.config.json in an ancestor directory", () => {
    const subDir = join(tmp, "a", "b", "c");
    mkdirSync(subDir, { recursive: true });
    const dataDir = "my-data";
    writeFileSync(join(tmp, "sidjua.config.json"), JSON.stringify({ dataDir }));
    const result = findDataDir(subDir);
    expect(result).toBe(resolve(tmp, dataDir));
  });

  it("returns null for malformed sidjua.config.json", () => {
    writeFileSync(join(tmp, "sidjua.config.json"), "not-valid-json{{{");
    const result = findDataDir(tmp);
    expect(result).toBeNull();
  });

  it("returns null when dataDir field is missing", () => {
    writeFileSync(join(tmp, "sidjua.config.json"), JSON.stringify({ other: "field" }));
    const result = findDataDir(tmp);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validatePaths
// ---------------------------------------------------------------------------

describe("validatePaths", () => {
  it("throws when system root does not exist", () => {
    const paths = resolvePaths("/tmp/fake-data");
    const badPaths = { ...paths, system: { ...paths.system, root: "/nonexistent/path/xyz" } };
    expect(() => validatePaths(badPaths)).toThrow(/system directory not found/i);
  });

  it("throws when system VERSION file is missing", () => {
    const tmp = makeTempDir();
    try {
      const paths = resolvePaths("/tmp/fake-data");
      const badPaths = {
        ...paths,
        system: { ...paths.system, root: tmp, version: join(tmp, "VERSION") },
      };
      expect(() => validatePaths(badPaths)).toThrow(/VERSION missing/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes when system root and VERSION exist", () => {
    const tmp = makeTempDir();
    try {
      writeFileSync(join(tmp, "VERSION"), "0.10.0\n");
      const paths = resolvePaths("/tmp/fake-data");
      const goodPaths = {
        ...paths,
        system: { ...paths.system, root: tmp, version: join(tmp, "VERSION") },
      };
      expect(() => validatePaths(goodPaths)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getPaths singleton
// ---------------------------------------------------------------------------

describe("getPaths singleton", () => {
  beforeEach(() => {
    resetPathsSingleton();
  });

  afterEach(() => {
    resetPathsSingleton();
  });

  it("returns the same instance on repeated calls", () => {
    const a = getPaths();
    const b = getPaths();
    expect(a).toBe(b); // same reference
  });

  it("returns a new instance after reset", () => {
    const a = getPaths();
    resetPathsSingleton();
    const b = getPaths();
    expect(a).not.toBe(b);
  });
});
