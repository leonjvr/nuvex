// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp }                          from "node:fs/promises";
import { join }                             from "node:path";
import { tmpdir }                           from "node:os";
import * as registry                        from "../../src/modules/module-registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sidjua-reg-test-"));
});

// Note: cleanup is best-effort; temp dirs are cleaned on OS restart anyway

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("module-registry", () => {
  it("returns empty list when registry does not exist", async () => {
    const result = await registry.getInstalled(workDir);
    expect(result).toEqual([]);
  });

  it("isInstalled returns false for unknown module", async () => {
    const result = await registry.isInstalled(workDir, "discord");
    expect(result).toBe(false);
  });

  it("register() persists an entry", async () => {
    await registry.register(workDir, {
      id:          "discord",
      installPath: "/tmp/discord",
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    const installed = await registry.getInstalled(workDir);
    expect(installed).toHaveLength(1);
    expect(installed[0]?.id).toBe("discord");
    expect(installed[0]?.installPath).toBe("/tmp/discord");
  });

  it("isInstalled returns true after register()", async () => {
    await registry.register(workDir, {
      id:          "discord",
      installPath: "/tmp/discord",
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await registry.isInstalled(workDir, "discord");
    expect(result).toBe(true);
  });

  it("register() is idempotent — updates existing entry", async () => {
    await registry.register(workDir, {
      id:          "discord",
      installPath: "/tmp/old",
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    await registry.register(workDir, {
      id:          "discord",
      installPath: "/tmp/new",
      installedAt: "2026-01-02T00:00:00.000Z",
    });

    const installed = await registry.getInstalled(workDir);
    expect(installed).toHaveLength(1);
    expect(installed[0]?.installPath).toBe("/tmp/new");
  });

  it("unregister() removes a registered module", async () => {
    await registry.register(workDir, {
      id:          "discord",
      installPath: "/tmp/discord",
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    await registry.unregister(workDir, "discord");

    const result = await registry.isInstalled(workDir, "discord");
    expect(result).toBe(false);
  });

  it("unregister() is a no-op for uninstalled module", async () => {
    // Should not throw
    await expect(registry.unregister(workDir, "discord")).resolves.toBeUndefined();
  });

  it("getInstallPath returns path for installed module", async () => {
    await registry.register(workDir, {
      id:          "discord",
      installPath: "/tmp/discord",
      installedAt: "2026-01-01T00:00:00.000Z",
    });

    const path = await registry.getInstallPath(workDir, "discord");
    expect(path).toBe("/tmp/discord");
  });

  it("getInstallPath returns undefined for uninstalled module", async () => {
    const path = await registry.getInstallPath(workDir, "discord");
    expect(path).toBeUndefined();
  });

  it("getInstalled returns multiple entries", async () => {
    await registry.register(workDir, { id: "discord", installPath: "/tmp/d", installedAt: "2026-01-01T00:00:00.000Z" });
    await registry.register(workDir, { id: "sap",     installPath: "/tmp/s", installedAt: "2026-01-01T00:00:00.000Z" });

    const installed = await registry.getInstalled(workDir);
    expect(installed).toHaveLength(2);
    expect(installed.map((e) => e.id).sort()).toEqual(["discord", "sap"]);
  });
});
