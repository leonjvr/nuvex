/**
 * SIDJUA — Multi-Agent Governance Framework
 * Copyright (c) 2026 Götz Kohlberg
 *
 * Dual licensed under:
 *   - AGPL-3.0 (see LICENSE-AGPL)
 *   - SIDJUA Commercial License (see LICENSE-COMMERCIAL)
 *
 * Unless you have a signed Commercial License, your use is governed
 * by the AGPL-3.0. See LICENSE for details.
 */

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../src/cli/utils/process.js", () => ({
  isProcessAlive: vi.fn(),
}));

vi.mock("../../../src/cli/ipc-client.js", () => ({
  sendIpc: vi.fn().mockRejectedValue(new Error("no socket")),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sidjua-shutdown-test-"));
  mkdirSync(join(dir, ".system"), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests: runShutdownCommand
// ---------------------------------------------------------------------------

describe("runShutdownCommand", () => {
  let workDir: string;
  let isProcessAlive: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    workDir = makeTmpDir();
    vi.resetAllMocks();
    const mod = await import("../../../src/cli/utils/process.js");
    isProcessAlive = mod.isProcessAlive as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns 1 when no PID file exists (not running)", async () => {
    const { runShutdownCommand } = await import("../../../src/cli/commands/shutdown.js");
    const stderr: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === "string") stderr.push(chunk);
      return true;
    };
    try {
      const code = await runShutdownCommand({ workDir, timeout: 5, force: false });
      expect(code).toBe(1);
      expect(stderr.join("")).toMatch(/not running/i);
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("returns 1 when PID file contains stale PID", async () => {
    const { runShutdownCommand } = await import("../../../src/cli/commands/shutdown.js");
    const pidFile = join(workDir, ".system", "orchestrator.pid");
    writeFileSync(pidFile, "999999", "utf8");
    isProcessAlive.mockReturnValue(false);

    const stderr: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === "string") stderr.push(chunk);
      return true;
    };
    try {
      const code = await runShutdownCommand({ workDir, timeout: 5, force: false });
      expect(code).toBe(1);
    } finally {
      process.stderr.write = origWrite;
    }
    // Stale PID file should be cleaned up
    expect(existsSync(pidFile)).toBe(false);
  });

  it("does NOT delete PID/socket files when process is still alive after timeout", { timeout: 15_000 }, async () => {
    const pidFile  = join(workDir, ".system", "orchestrator.pid");
    const sockFile = join(workDir, ".system", "orchestrator.sock");
    writeFileSync(pidFile,  "12345", "utf8");
    writeFileSync(sockFile, "",      "utf8");

    // isProcessAlive always returns true — process never exits
    isProcessAlive.mockReturnValue(true);

    const { runShutdownCommand } = await import("../../../src/cli/commands/shutdown.js");

    const origErrWrite = process.stderr.write.bind(process.stderr);
    const origOutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = () => true;
    process.stdout.write = () => true;

    let code: number;
    try {
      code = await runShutdownCommand({ workDir, timeout: 1, force: false });
    } finally {
      process.stderr.write = origErrWrite;
      process.stdout.write = origOutWrite;
    }

    expect(code!).toBe(1);
    // PID and socket files must NOT be deleted when process is still alive
    expect(existsSync(pidFile)).toBe(true);
    expect(existsSync(sockFile)).toBe(true);
  });

  it("returns 0 and cleans up PID/socket when process exits cleanly", async () => {
    const pidFile  = join(workDir, ".system", "orchestrator.pid");
    const sockFile = join(workDir, ".system", "orchestrator.sock");
    writeFileSync(pidFile,  "12345", "utf8");
    writeFileSync(sockFile, "",      "utf8");

    // First call: alive (before IPC). Subsequent calls: dead (process exited).
    isProcessAlive
      .mockReturnValueOnce(true)   // initial alive check
      .mockReturnValue(false);     // process exits after IPC

    const { runShutdownCommand } = await import("../../../src/cli/commands/shutdown.js");

    const origErrWrite = process.stderr.write.bind(process.stderr);
    const origOutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = () => true;
    process.stdout.write = () => true;

    let code: number;
    try {
      code = await runShutdownCommand({ workDir, timeout: 5, force: false });
    } finally {
      process.stderr.write = origErrWrite;
      process.stdout.write = origOutWrite;
    }

    expect(code!).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
    expect(existsSync(sockFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: stop-orchestrator success semantics (fix for stale success reporting)
// ---------------------------------------------------------------------------

describe("runStopOrchestratorCommand — success semantics", () => {
  let workDir: string;
  let isProcessAlive: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    workDir = makeTmpDir();
    vi.resetAllMocks();
    const mod = await import("../../../src/cli/utils/process.js");
    isProcessAlive = mod.isProcessAlive as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns 1 and does NOT delete PID file when process still alive after timeout", { timeout: 15_000 }, async () => {
    const pidFile  = join(workDir, ".system", "orchestrator.pid");
    const sockFile = join(workDir, ".system", "orchestrator.sock");
    writeFileSync(pidFile,  "12345", "utf8");
    writeFileSync(sockFile, "",      "utf8");

    // Always alive
    isProcessAlive.mockReturnValue(true);

    const { runStopOrchestratorCommand } = await import("../../../src/cli/commands/stop-orchestrator.js");

    const stderr: string[] = [];
    const origErrWrite = process.stderr.write.bind(process.stderr);
    const origOutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = (chunk: string | Uint8Array) => {
      if (typeof chunk === "string") stderr.push(chunk);
      return true;
    };
    process.stdout.write = () => true;

    let code: number;
    try {
      code = await runStopOrchestratorCommand({ workDir, force: false, timeout: 1 });
    } finally {
      process.stderr.write = origErrWrite;
      process.stdout.write = origOutWrite;
    }

    expect(code!).toBe(1);
    expect(stderr.join("")).toMatch(/still running/i);
    // PID file must NOT be deleted
    expect(existsSync(pidFile)).toBe(true);
  });

  it("returns 0 and cleans up when process exits", async () => {
    const pidFile = join(workDir, ".system", "orchestrator.pid");
    writeFileSync(pidFile, "12345", "utf8");

    // Alive on first check, dead afterwards
    isProcessAlive
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const { runStopOrchestratorCommand } = await import("../../../src/cli/commands/stop-orchestrator.js");

    const origErrWrite = process.stderr.write.bind(process.stderr);
    const origOutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = () => true;
    process.stdout.write = () => true;

    let code: number;
    try {
      code = await runStopOrchestratorCommand({ workDir, force: false, timeout: 5 });
    } finally {
      process.stderr.write = origErrWrite;
      process.stdout.write = origOutWrite;
    }

    expect(code!).toBe(0);
    expect(existsSync(pidFile)).toBe(false);
  });
});
