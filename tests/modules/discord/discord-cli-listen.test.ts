// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Module-loader mock must be declared before the imports that use it
vi.mock("../../../src/modules/module-loader.js", () => ({
  getModuleStatus: vi.fn(),
  loadModuleSecrets: vi.fn().mockResolvedValue({}),
  loadModuleConfig: vi.fn().mockResolvedValue({}),
  AVAILABLE_MODULES: ["discord"],
  listAvailableModules: vi.fn().mockReturnValue([]),
  installModule: vi.fn(),
  uninstallModule: vi.fn(),
  listInstalledModules: vi.fn().mockResolvedValue([]),
  parseDotenv: vi.fn().mockReturnValue({}),
}));

import { getModuleStatus } from "../../../src/modules/module-loader.js";
import {
  runDiscordListenStatus,
  runDiscordListenStart,
  runDiscordListenLogs,
} from "../../../src/cli/commands/discord.js";
import { DISCORD_SERVICE_FILE } from "../../../src/modules/discord/templates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-cli-test-"));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discord listen status", () => {
  // Test 20: listen status — shows stopped when module not installed
  it("returns 1 and prints stopped when module is not installed", async () => {
    (getModuleStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "discord", installed: false, configured: false, secretsSet: false, missingSecrets: [],
    });

    const exitCode = await runDiscordListenStatus({ workDir: tmpDir });
    expect(exitCode).toBe(1);
    const output = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls
      .flat()
      .join("");
    expect(output.toLowerCase()).toContain("not install");
  });

  it("shows running status when PID file exists and process is alive", async () => {
    const moduleDir = join(tmpDir, "modules", "discord");
    mkdirSync(moduleDir, { recursive: true });

    // Write PID file pointing to current process
    const { writePidFile } = await import("../../../src/modules/discord/gateway-daemon.js");
    const pidFile = join(moduleDir, "gateway.pid");
    writePidFile(pidFile, process.pid);

    (getModuleStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "discord", installed: true, configured: true, secretsSet: true,
      missingSecrets: [], installPath: moduleDir,
    });

    const exitCode = await runDiscordListenStatus({ workDir: tmpDir });
    const output = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls
      .flat()
      .join("");
    expect(output).toContain(String(process.pid));
    expect(exitCode).toBe(0);
  });
});

describe("discord listen start", () => {
  // Test 21: listen start — validates config first
  it("returns 1 when module is not installed", async () => {
    (getModuleStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "discord", installed: false, configured: false, secretsSet: false, missingSecrets: [],
    });

    const exitCode = await runDiscordListenStart({ workDir: tmpDir });
    expect(exitCode).toBe(1);
    const errOutput = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls
      .flat()
      .join("");
    expect(errOutput.toLowerCase()).toMatch(/install|not install/);
  });
});

describe("systemd service file", () => {
  // Test 22: service file content correct
  it("contains correct Unit, Service, and Install sections", () => {
    expect(DISCORD_SERVICE_FILE).toContain("[Unit]");
    expect(DISCORD_SERVICE_FILE).toContain("[Service]");
    expect(DISCORD_SERVICE_FILE).toContain("[Install]");
    expect(DISCORD_SERVICE_FILE).toContain("gateway-daemon-bin.js");
    expect(DISCORD_SERVICE_FILE).toContain("Restart=on-failure");
    expect(DISCORD_SERVICE_FILE).toContain("SyslogIdentifier=sidjua-discord");
  });

  it("has correct description", () => {
    expect(DISCORD_SERVICE_FILE).toContain("SIDJUA Discord Gateway Bot");
  });

  it("requires network online", () => {
    expect(DISCORD_SERVICE_FILE).toContain("network-online.target");
  });
});

describe("discord listen logs", () => {
  it("prints journalctl instructions and returns 0", async () => {
    const exitCode = await runDiscordListenLogs();
    expect(exitCode).toBe(0);
    const output = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls
      .flat()
      .join("");
    expect(output).toContain("journalctl");
    expect(output).toContain("sidjua-discord");
  });
});
