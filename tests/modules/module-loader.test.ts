// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir }        from "node:fs/promises";
import { join }                             from "node:path";
import { tmpdir }                           from "node:os";
import {
  listAvailableModules,
  getModuleStatus,
  installModule,
  uninstallModule,
  listInstalledModules,
  loadModuleSecrets,
  parseDotenv,
  AVAILABLE_MODULES,
} from "../../src/modules/module-loader.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sidjua-loader-test-"));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listAvailableModules", () => {
  it("returns at least the discord module", () => {
    const modules = listAvailableModules();
    expect(modules.length).toBeGreaterThan(0);
    const ids = modules.map((m) => m.id);
    expect(ids).toContain("discord");
  });

  it("each module has id, name, description, category", () => {
    const modules = listAvailableModules();
    for (const { id, manifest } of modules) {
      expect(id).toBeTruthy();
      expect(manifest.name).toBeTruthy();
      expect(manifest.description).toBeTruthy();
      expect(manifest.category).toBeTruthy();
    }
  });

  it("AVAILABLE_MODULES contains 'discord'", () => {
    expect(AVAILABLE_MODULES).toContain("discord");
  });
});

describe("getModuleStatus — not installed", () => {
  it("returns installed: false for uninstalled module", async () => {
    const status = await getModuleStatus(workDir, "discord");
    expect(status.installed).toBe(false);
    expect(status.configured).toBe(false);
  });

  it("returns installed: false for unknown module id", async () => {
    const status = await getModuleStatus(workDir, "unknown-xyz");
    expect(status.installed).toBe(false);
    expect(status.manifest).toBeUndefined();
  });
});

describe("installModule", () => {
  it("installs discord module — creates data directory", async () => {
    await installModule(workDir, "discord");
    const status = await getModuleStatus(workDir, "discord");
    expect(status.installed).toBe(true);
    expect(status.installPath).toBeTruthy();
  });

  it("writes template files on install", async () => {
    await installModule(workDir, "discord");
    const status = await getModuleStatus(workDir, "discord");
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(status.installPath!, "module.yaml"))).toBe(true);
    expect(existsSync(join(status.installPath!, "agent.yaml"))).toBe(true);
    expect(existsSync(join(status.installPath!, "skill.md"))).toBe(true);
    expect(existsSync(join(status.installPath!, "README.md"))).toBe(true);
  });

  it("install is idempotent — can be called twice", async () => {
    await installModule(workDir, "discord");
    await installModule(workDir, "discord"); // should not throw
    const installed = await listInstalledModules(workDir);
    expect(installed).toHaveLength(1);
  });

  it("throws for unknown module id", async () => {
    // Non-first-party modules now throw MOD-003 (first-party policy check)
    // before the manifest lookup, so the error message differs from the old
    // "Unknown module" message.
    await expect(installModule(workDir, "nonexistent-module")).rejects.toThrow();
  });
});

describe("uninstallModule", () => {
  it("removes installed module", async () => {
    await installModule(workDir, "discord");
    await uninstallModule(workDir, "discord");

    const status = await getModuleStatus(workDir, "discord");
    expect(status.installed).toBe(false);
  });

  it("throws if module not installed", async () => {
    await expect(uninstallModule(workDir, "discord")).rejects.toThrow(/not installed/);
  });

  it("removes data directory on uninstall", async () => {
    await installModule(workDir, "discord");
    const status = await getModuleStatus(workDir, "discord");
    const installPath = status.installPath!;

    await uninstallModule(workDir, "discord");

    const { existsSync } = await import("node:fs");
    expect(existsSync(installPath)).toBe(false);
  });
});

describe("listInstalledModules", () => {
  it("returns empty array when nothing installed", async () => {
    const result = await listInstalledModules(workDir);
    expect(result).toEqual([]);
  });

  it("returns installed modules after install", async () => {
    await installModule(workDir, "discord");
    const result = await listInstalledModules(workDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("discord");
  });
});

describe("loadModuleSecrets", () => {
  it("returns empty object if no .env file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sidjua-secrets-test-"));
    const secrets = await loadModuleSecrets(dir);
    expect(secrets).toEqual({});
  });

  it("reads KEY=VALUE pairs from .env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sidjua-secrets-test-"));
    await writeFile(join(dir, ".env"), "FOO=bar\nBAZ=qux\n");
    const secrets = await loadModuleSecrets(dir);
    expect(secrets["FOO"]).toBe("bar");
    expect(secrets["BAZ"]).toBe("qux");
  });
});

describe("parseDotenv", () => {
  it("parses KEY=VALUE pairs", () => {
    const result = parseDotenv("FOO=bar\nBAZ=qux\n");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comments and blank lines", () => {
    const result = parseDotenv("# comment\n\nFOO=bar\n");
    expect(result).toEqual({ FOO: "bar" });
  });

  it("strips surrounding double quotes", () => {
    const result = parseDotenv('FOO="hello world"\n');
    expect(result["FOO"]).toBe("hello world");
  });

  it("strips surrounding single quotes", () => {
    const result = parseDotenv("FOO='hello world'\n");
    expect(result["FOO"]).toBe("hello world");
  });

  it("handles empty value", () => {
    const result = parseDotenv("FOO=\n");
    expect(result["FOO"]).toBe("");
  });

  it("handles value with equals sign", () => {
    const result = parseDotenv("FOO=a=b\n");
    expect(result["FOO"]).toBe("a=b");
  });
});
