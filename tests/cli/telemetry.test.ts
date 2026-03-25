// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync }    from "node:fs";
import { tmpdir }                                            from "node:os";
import { join }                                              from "node:path";
import {
  runStatusCommand,
  runEnableCommand,
  runDisableCommand,
  runFlushCommand,
  runResetCommand,
} from "../../src/cli/commands/telemetry.js";
import { loadTelemetryConfig }                               from "../../src/core/telemetry/telemetry-reporter.js";
import { resetTelemetryReporter }                            from "../../src/core/telemetry/telemetry-reporter.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;

function writeConfig(config: object): void {
  writeFileSync(join(tmpDir, ".system", "telemetry.json"), JSON.stringify(config), "utf-8");
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-tel-cli-"));
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
  resetTelemetryReporter();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetTelemetryReporter();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe("runStatusCommand", () => {
  it("returns 0 and writes status to stdout", async () => {
    writeConfig({
      mode:             "auto",
      installationId:   "uuid-1234",
      primaryEndpoint:  "https://errors.sidjua.com/v1/report",
      fallbackEndpoint: "https://errors-direct.sidjua.com/v1/report",
    });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { stdout.push(String(s)); return true; });

    const code = await runStatusCommand(tmpDir, false);
    expect(code).toBe(0);

    const output = stdout.join("");
    expect(output).toContain("auto");
    expect(output).toContain("uuid-1234");
    expect(output).toContain("Pending");
  });

  it("returns JSON with --json flag", async () => {
    writeConfig({
      mode:             "off",
      installationId:   "uuid-5678",
      primaryEndpoint:  "https://p.example.com",
      fallbackEndpoint: "https://f.example.com",
    });

    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { chunks.push(String(s)); return true; });

    const code = await runStatusCommand(tmpDir, true);
    expect(code).toBe(0);

    const json = JSON.parse(chunks.join(""));
    expect(json.mode).toBe("off");
    expect(json.installationId).toBe("uuid-5678");
    expect(json.buffer).toBeDefined();
    expect(json.buffer.pending).toBeGreaterThanOrEqual(0);
  });

  it("generates installationId if missing", async () => {
    // No config file — should auto-generate
    const code = await runStatusCommand(tmpDir, false);
    expect(code).toBe(0);

    const config = await loadTelemetryConfig(tmpDir);
    expect(config.installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

// ---------------------------------------------------------------------------
// enable
// ---------------------------------------------------------------------------

describe("runEnableCommand", () => {
  it("sets mode to auto and returns 0", async () => {
    writeConfig({ mode: "off", installationId: "uuid-abc" });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { stdout.push(String(s)); return true; });

    const code = await runEnableCommand(tmpDir);
    expect(code).toBe(0);

    const config = await loadTelemetryConfig(tmpDir);
    expect(config.mode).toBe("auto");
    expect(stdout.join("")).toContain("enabled");
  });

  it("reports already enabled if mode=auto", async () => {
    writeConfig({ mode: "auto", installationId: "uuid-def" });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { stdout.push(String(s)); return true; });

    const code = await runEnableCommand(tmpDir);
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("already enabled");
  });
});

// ---------------------------------------------------------------------------
// disable
// ---------------------------------------------------------------------------

describe("runDisableCommand", () => {
  it("sets mode to off and returns 0", async () => {
    writeConfig({ mode: "auto", installationId: "uuid-ghi" });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { stdout.push(String(s)); return true; });

    const code = await runDisableCommand(tmpDir);
    expect(code).toBe(0);

    const config = await loadTelemetryConfig(tmpDir);
    expect(config.mode).toBe("off");
    expect(stdout.join("")).toContain("disabled");
  });

  it("reports already disabled if mode=off", async () => {
    writeConfig({ mode: "off", installationId: "uuid-jkl" });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { stdout.push(String(s)); return true; });

    const code = await runDisableCommand(tmpDir);
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("already disabled");
  });
});

// ---------------------------------------------------------------------------
// flush
// ---------------------------------------------------------------------------

describe("runFlushCommand", () => {
  it("reports no pending events when buffer is empty", async () => {
    writeConfig({ mode: "auto", installationId: "uuid-flush" });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { stdout.push(String(s)); return true; });

    const code = await runFlushCommand(tmpDir, false);
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("No pending");
  });

  it("returns JSON with --json flag when buffer empty", async () => {
    writeConfig({ mode: "auto", installationId: "uuid-flush-json" });

    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { chunks.push(String(s)); return true; });

    const code = await runFlushCommand(tmpDir, true);
    expect(code).toBe(0);
    const json = JSON.parse(chunks.join(""));
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(0);
    expect(json.pending).toBe(0);
  });

  it("returns 1 when flush has failures", async () => {
    writeConfig({
      mode:             "auto",
      installationId:   "uuid-flush-fail",
      primaryEndpoint:  "http://localhost:19999/primary",
      fallbackEndpoint: "http://localhost:19999/fallback",
    });

    // Add a pending event via buffer
    const { openTelemetryBuffer } = await import("../../src/core/telemetry/telemetry-buffer.js");
    const buf = openTelemetryBuffer(tmpDir);
    buf.store({
      installation_id: "uuid-flush-fail",
      fingerprint:     "fp-abc",
      error_type:      "TestError",
      error_message:   "test",
      stack_hash:      "aa".repeat(32),
      sidjua_version:  "0.10.0",
      node_version:    "v22",
      os:              "linux",
      arch:            "x64",
      timestamp:       new Date().toISOString(),
      severity:        "medium",
    });
    buf.close();

    // Network will fail
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runFlushCommand(tmpDir, false);
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("runResetCommand", () => {
  it("requires --confirm flag", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => { stderr.push(String(s)); return true; });

    const code = await runResetCommand(tmpDir, false);
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("--confirm");
  });

  it("clears buffer and regenerates installation ID with --confirm", async () => {
    writeConfig({ mode: "auto", installationId: "old-uuid-to-replace" });

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { stdout.push(String(s)); return true; });

    const code = await runResetCommand(tmpDir, true);
    expect(code).toBe(0);

    const newConfig = await loadTelemetryConfig(tmpDir);
    expect(newConfig.installationId).not.toBe("old-uuid-to-replace");
    expect(newConfig.installationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(stdout.join("")).toContain("reset complete");
  });
});
