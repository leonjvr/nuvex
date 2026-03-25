// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Path traversal prevention tests (#519 B4 B5).
 *
 * B4: Backup restoration — tar archive with "../" entries or symlinks
 *     that point outside the target directory.
 *
 * B5: Skill path resolution — null bytes, ".." traversal, absolute paths,
 *     non-existent paths return resolved (not raw) path.
 *
 * Shared utility: assertWithinDirectory, checkArchiveEntry, validateExtractedPaths.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertWithinDirectory,
  checkArchiveEntry,
  validateArchiveEntries,
  validateExtractedPaths,
} from "../../src/utils/path-utils.js";
import { resolveSkillPath } from "../../src/agent-lifecycle/agent-template.js";
import { SidjuaError }      from "../../src/core/error-codes.js";
import { VersionArchiveManager } from "../../src/core/update/version-archive.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-path-sec-"));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function makeTempDir(suffix: string): string {
  const d = join(tmpDir, suffix);
  mkdirSync(d, { recursive: true });
  return d;
}

// Create a legitimate tar.gz archive of a directory
async function makeLegitArchive(srcDir: string, dest: string): Promise<void> {
  await execFileAsync("tar", ["-czf", dest, "-C", srcDir, "."]);
}

// ---------------------------------------------------------------------------
// Shared utility: assertWithinDirectory
// ---------------------------------------------------------------------------

describe("assertWithinDirectory — shared path containment guard", () => {
  it("passes when path equals baseDir", () => {
    const base = makeTempDir("base");
    expect(() => assertWithinDirectory(base, base)).not.toThrow();
  });

  it("passes when path is directly within baseDir", () => {
    const base = makeTempDir("base");
    expect(() => assertWithinDirectory(join(base, "file.txt"), base)).not.toThrow();
  });

  it("passes when path is in a sub-directory of baseDir", () => {
    const base = makeTempDir("base");
    expect(() => assertWithinDirectory(join(base, "a", "b", "c.txt"), base)).not.toThrow();
  });

  it("throws SEC-010 when path escapes via '..'", () => {
    const base = makeTempDir("base");
    expect(() => assertWithinDirectory(join(base, "..", "escape"), base))
      .toThrow(SidjuaError);
  });

  it("throws SEC-010 when path is outside baseDir entirely", () => {
    const base = makeTempDir("base");
    expect(() => assertWithinDirectory("/etc/passwd", base)).toThrow(SidjuaError);
  });

  it("throws SEC-010 for sibling directories", () => {
    const base    = makeTempDir("base");
    const sibling = makeTempDir("sibling");
    expect(() => assertWithinDirectory(sibling, base)).toThrow(SidjuaError);
  });

  it("resolves '..' before checking — no TOCTOU on path strings", () => {
    const base = makeTempDir("base");
    // join(base, "sub/../../../etc") → normalizes to something outside base
    expect(() => assertWithinDirectory(join(base, "sub", "..", "..", "..", "etc"), base))
      .toThrow(SidjuaError);
  });
});

// ---------------------------------------------------------------------------
// Shared utility: checkArchiveEntry
// ---------------------------------------------------------------------------

describe("checkArchiveEntry — archive entry validation", () => {
  it("accepts a normal relative entry", () => {
    expect(() => checkArchiveEntry("./config.json")).not.toThrow();
    expect(() => checkArchiveEntry("data/file.txt")).not.toThrow();
  });

  it("accepts the root '.' entry", () => {
    expect(() => checkArchiveEntry(".")).not.toThrow();
  });

  it("throws SEC-010 for absolute paths", () => {
    expect(() => checkArchiveEntry("/etc/passwd")).toThrow(SidjuaError);
  });

  it("throws SEC-010 for '..' as a leading component", () => {
    expect(() => checkArchiveEntry("../../etc/passwd")).toThrow(SidjuaError);
  });

  it("throws SEC-010 for '..' buried in the path", () => {
    expect(() => checkArchiveEntry("./sub/../../../etc/passwd")).toThrow(SidjuaError);
  });

  it("throws SEC-010 for null bytes", () => {
    expect(() => checkArchiveEntry("file\0name")).toThrow(SidjuaError);
  });
});

// ---------------------------------------------------------------------------
// B4 — validateArchiveEntries: pre-extraction check on real archive
// ---------------------------------------------------------------------------

describe("B4: validateArchiveEntries — legitimate archive passes", () => {
  it("does not throw for an archive containing only safe entries", async () => {
    const srcDir = makeTempDir("src");
    writeFileSync(join(srcDir, "config.json"), '{"version":"1"}');
    mkdirSync(join(srcDir, "data"), { recursive: true });
    writeFileSync(join(srcDir, "data", "db.sqlite"), "sqlite data");

    const archivePath = join(tmpDir, "safe.tar.gz");
    await makeLegitArchive(srcDir, archivePath);

    await expect(validateArchiveEntries(archivePath)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// B4 — validateExtractedPaths: post-extraction symlink guard
// ---------------------------------------------------------------------------

describe("B4: validateExtractedPaths — symlink escape detection", () => {
  it("does not throw when no symlinks are present", async () => {
    const target = makeTempDir("target");
    writeFileSync(join(target, "file.txt"), "safe content");
    await expect(validateExtractedPaths(target)).resolves.toBeUndefined();
  });

  it("does not throw for symlinks pointing within targetDir", async () => {
    const target = makeTempDir("target");
    writeFileSync(join(target, "real.txt"), "original");
    symlinkSync("real.txt", join(target, "link.txt"));
    await expect(validateExtractedPaths(target)).resolves.toBeUndefined();
  });

  it("throws SEC-010 and removes symlink when it points outside targetDir", async () => {
    const target   = makeTempDir("target");
    const outside  = makeTempDir("outside");
    writeFileSync(join(outside, "secret.txt"), "secret data");

    // Create a symlink inside target pointing to the outside directory
    symlinkSync(join(outside, "secret.txt"), join(target, "evil-link.txt"));

    await expect(validateExtractedPaths(target)).rejects.toThrow(SidjuaError);

    // The dangerous symlink must have been removed
    expect(existsSync(join(target, "evil-link.txt"))).toBe(false);
  });

  it("throws SEC-010 for a symlink pointing to a parent directory", async () => {
    const target = makeTempDir("target");
    // Symlink points to the parent of target
    symlinkSync("..", join(target, "escape-link"));
    await expect(validateExtractedPaths(target)).rejects.toThrow(SidjuaError);
  });
});

// ---------------------------------------------------------------------------
// B4 — VersionArchiveManager.restoreSystem: version parameter traversal
// ---------------------------------------------------------------------------

describe("B4: VersionArchiveManager.restoreSystem — version parameter validation", () => {
  it("throws when version string contains path traversal", async () => {
    const installDir = makeTempDir("install");
    const systemDir  = makeTempDir("system");
    writeFileSync(join(systemDir, "VERSION"), "0.11.0");

    const mgr = new VersionArchiveManager(installDir, systemDir);
    // Create a legitimate archive first so we have a versionsDir
    await mgr.archiveCurrentSystem("0.11.0");

    // Now attempt to restore with a traversal version string
    await expect(mgr.restoreSystem("../../etc")).rejects.toThrow(SidjuaError);
  });

  it("restores successfully from a legitimate archive", async () => {
    const installDir = makeTempDir("install");
    const systemDir  = makeTempDir("system");
    mkdirSync(join(systemDir, "governance"), { recursive: true });
    writeFileSync(join(systemDir, "VERSION"), "0.11.0");
    writeFileSync(join(systemDir, "governance", "VERSION"), JSON.stringify({
      ruleset_version: "1.0", compatible_sidjua_min: "0.11.0",
      compatible_sidjua_max: "0.x.x", released: "2026-01-01T00:00:00Z",
      rules_count: 1, changelog: "test",
    }));

    const mgr = new VersionArchiveManager(installDir, systemDir);
    await mgr.archiveCurrentSystem("0.11.0");

    // Modify system dir, then restore
    writeFileSync(join(systemDir, "VERSION"), "0.99.0");
    await mgr.restoreSystem("0.11.0");

    // The restored file should have the archived content
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(systemDir, "VERSION"), "utf-8")).toBe("0.11.0");
  });
});

// ---------------------------------------------------------------------------
// B4 — version-archive.ts source check: --strip-components=1
// ---------------------------------------------------------------------------

describe("B4: version-archive.ts source — uses --strip-components=1", () => {
  it("restoreSystem uses --strip-components=1", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/core/update/version-archive.ts", "utf-8");
    // Must have --strip-components=1 in the extraction command
    expect(src).toContain("--strip-components=1");
  });

  it("restoreSystem calls validateArchiveEntries (pre-extraction)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/core/update/version-archive.ts", "utf-8");
    expect(src).toContain("validateArchiveEntries");
  });

  it("restoreSystem calls validateExtractedPaths (post-extraction)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/core/update/version-archive.ts", "utf-8");
    expect(src).toContain("validateExtractedPaths");
  });

  it("restoreSystem calls assertWithinDirectory for version parameter", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/core/update/version-archive.ts", "utf-8");
    expect(src).toContain("assertWithinDirectory");
  });
});

// ---------------------------------------------------------------------------
// B5 — resolveSkillPath: null bytes, traversal, absolute, non-existent
// ---------------------------------------------------------------------------

describe("B5: resolveSkillPath — path traversal prevention", () => {
  it("throws SEC-010 for path with embedded null byte", () => {
    const workDir = makeTempDir("work");
    expect(() => resolveSkillPath(workDir, "skills/my-skill\0.md"))
      .toThrow(/null byte|SEC-010/i);
  });

  it("throws SEC-010 for '../../../etc/passwd' traversal", () => {
    const workDir = makeTempDir("work");
    expect(() => resolveSkillPath(workDir, "../../../etc/passwd"))
      .toThrow(/path traversal|SEC-010/i);
  });

  it("throws SEC-010 for absolute path outside workDir", () => {
    const workDir = makeTempDir("work");
    expect(() => resolveSkillPath(workDir, "/etc/passwd"))
      .toThrow(/absolute|SEC-010/i);
  });

  it("resolves valid relative path within workDir", () => {
    const workDir = makeTempDir("work");
    mkdirSync(join(workDir, "agents", "skills"), { recursive: true });
    writeFileSync(join(workDir, "agents", "skills", "guide.md"), "# Guide");

    const result = resolveSkillPath(workDir, "agents/skills/guide.md");
    expect(result).toBe(join(workDir, "agents", "skills", "guide.md"));
  });

  it("returns resolved (not raw) path for non-existent skill file", () => {
    const workDir = makeTempDir("work");
    // "a/b/../c.md" is non-existent; result must be the normalized absolute path
    const result = resolveSkillPath(workDir, "a/b/../c.md");
    // Must be an absolute path ending in workDir/a/c.md (not "a/b/../c.md")
    expect(result).toBe(join(workDir, "a", "c.md"));
    expect(result).not.toContain("..");
  });

  it("throws SEC-010 for symlink pointing outside workDir", () => {
    const workDir  = makeTempDir("work");
    const outside  = makeTempDir("outside");
    writeFileSync(join(outside, "secret.md"), "secret");
    symlinkSync(join(outside, "secret.md"), join(workDir, "evil-link.md"));
    expect(() => resolveSkillPath(workDir, "evil-link.md"))
      .toThrow(/symlink|SEC-010/i);
  });

  it("path traversal via encoded/normalized '..' is rejected", () => {
    const workDir = makeTempDir("work");
    // resolve() normalizes this before the check — must still be rejected
    expect(() => resolveSkillPath(workDir, "sub/../../escape"))
      .toThrow(/path traversal|SEC-010/i);
  });
});

// ---------------------------------------------------------------------------
// B5 — source check: null byte rejection present
// ---------------------------------------------------------------------------

describe("B5: agent-template.ts source — null byte check present", () => {
  it("resolveSkillPath source rejects null bytes", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/agent-lifecycle/agent-template.ts", "utf-8");
    expect(src).toContain("null byte");
    expect(src).toContain(`includes("\\0")`);
  });

  it("resolveSkillPath uses assertWithinDirectory from path-utils", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/agent-lifecycle/agent-template.ts", "utf-8");
    expect(src).toContain("assertWithinDirectory");
    expect(src).toContain("path-utils");
  });

  it("ENOENT path returns resolved path with comment explaining why it is safe", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/agent-lifecycle/agent-template.ts", "utf-8");
    // The comment must document that resolved (not skillPath) is returned
    expect(src).toContain("return resolved");
    expect(src).toContain("guaranteed within workDir");
  });
});
