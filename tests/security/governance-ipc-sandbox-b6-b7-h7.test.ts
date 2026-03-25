// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for #519 B6, B7, H7:
 *
 *   B6: --wait mode must emit a governance_bypass warning (bypasses orchestrator pipeline)
 *   B7: IPC socket directory uses 0o700 permissions; unknown commands are rejected
 *   H7: `sandbox check` exits 1 for provider "none" without --force; exits 0 with --force
 *
 * Tests cover both runtime behaviour and source-level structural checks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join }    from "node:path";
import { tmpdir }  from "node:os";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sandbox-runtime (required before sandbox.ts import)
// ---------------------------------------------------------------------------

const sandboxMocks = vi.hoisted(() => ({
  mockCheckDeps:  vi.fn().mockReturnValue({ errors: [], warnings: [] }),
  mockInitialize: vi.fn().mockResolvedValue(undefined),
  mockReset:      vi.fn().mockResolvedValue(undefined),
  mockGetProxy:   vi.fn().mockReturnValue(undefined),
  mockGetSocks:   vi.fn().mockReturnValue(undefined),
  mockWrapCmd:    vi.fn().mockImplementation(async (c: string) => c),
  mockGetStore:   vi.fn().mockReturnValue({ subscribe: vi.fn().mockReturnValue(() => {}) }),
}));

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize:               sandboxMocks.mockInitialize,
    reset:                    sandboxMocks.mockReset,
    checkDependencies:        sandboxMocks.mockCheckDeps,
    getProxyPort:             sandboxMocks.mockGetProxy,
    getSocksProxyPort:        sandboxMocks.mockGetSocks,
    wrapWithSandbox:          sandboxMocks.mockWrapCmd,
    getSandboxViolationStore: sandboxMocks.mockGetStore,
  },
}));

import { runSandboxCheckCommand } from "../../src/cli/commands/sandbox.js";

// ---------------------------------------------------------------------------
// Minimal divisions.yaml fixtures
// ---------------------------------------------------------------------------

const YAML_NONE = `
schema_version: '1.0'
company:
  name: TestCo
  size: solo
  locale: en
  timezone: UTC
size_presets:
  solo:
    recommended: []
    description: Solo mode
divisions:
  - code: engineering
    name:
      en: Engineering
    active: true
    required: true
    scope: Code
    head:
      role: Lead
      agent: test-agent
sandbox:
  provider: "none"
  defaults:
    network:
      allowedDomains: []
      deniedDomains: []
    filesystem:
      denyRead:
        - "~/.ssh"
      allowWrite: []
      denyWrite: []
`;

const YAML_BUBBLEWRAP = `
schema_version: '1.0'
company:
  name: TestCo
  size: solo
  locale: en
  timezone: UTC
size_presets:
  solo:
    recommended: []
    description: Solo mode
divisions:
  - code: engineering
    name:
      en: Engineering
    active: true
    required: true
    scope: Code
    head:
      role: Lead
      agent: test-agent
sandbox:
  provider: "bubblewrap"
  defaults:
    network:
      allowedDomains: []
      deniedDomains: []
    filesystem:
      denyRead:
        - "~/.ssh"
      allowWrite: []
      denyWrite: []
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  sandboxMocks.mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-sec-b6b7h7-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// B6: --wait mode governance_bypass warning
// ===========================================================================

// B6 #519 → P268: --wait inline execution removed entirely.
// The governance_bypass audit path was deleted in P268 because --wait now
// routes through the orchestrator. P268 tests in tests/api/p268-*.test.ts
// cover the new behavior; these B6 source checks verify the cleanup.
describe("B6 #519 (P268 supersedes): governance_bypass inline path removed", () => {
  it("run.ts source does NOT contain GOVERNANCE_BYPASS (removed by P268)", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toContain("GOVERNANCE_BYPASS");
  });

  it("run.ts source does NOT contain governance_bypass warning (removed by P268)", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toContain("WARNING [governance_bypass]");
  });

  it("run.ts --wait now requires orchestrator pid (governance enforced at orchestrator)", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("orchestrator.pid");
    expect(src).toContain("Orchestrator not running");
  });

  it("run.ts routes --wait through TASK_CREATED event (orchestrator governance)", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("TASK_CREATED");
    expect(src).toContain("pollTaskCompletion");
  });

  it("run.ts source does NOT contain UNSAFE_INLINE (removed by P268)", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toContain("UNSAFE_INLINE");
  });
});

// ===========================================================================
// B7: IPC socket directory permissions + unknown command rejection
// ===========================================================================

describe("B7 #519: IPC socket permissions and command whitelist", () => {
  it("orchestrator.ts source contains 0o700 socket directory mode", () => {
    const src = readFileSync(
      new URL("../../src/orchestrator/orchestrator.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("0o700");
  });

  it("orchestrator.ts logs ipc_connection for each new connection", () => {
    const src = readFileSync(
      new URL("../../src/orchestrator/orchestrator.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("ipc_connection");
  });

  it("orchestrator.ts defines ALLOWED_IPC_COMMANDS whitelist", () => {
    const src = readFileSync(
      new URL("../../src/orchestrator/orchestrator.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("ALLOWED_IPC_COMMANDS");
  });

  it("orchestrator.ts rejects unknown commands with an error response", () => {
    const src = readFileSync(
      new URL("../../src/orchestrator/orchestrator.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("Unknown IPC command");
  });

  it("orchestrator.ts whitelist includes all expected IPC commands", () => {
    const src = readFileSync(
      new URL("../../src/orchestrator/orchestrator.ts", import.meta.url),
      "utf-8",
    );
    // All 6 defined CLIRequest command types must be in the whitelist block
    const whitelistBlock = src.slice(
      src.indexOf("ALLOWED_IPC_COMMANDS"),
      src.indexOf("ALLOWED_IPC_COMMANDS") + 300,
    );
    expect(whitelistBlock).toContain("stop");
    expect(whitelistBlock).toContain("pause");
    expect(whitelistBlock).toContain("resume");
    expect(whitelistBlock).toContain("submit_task");
    expect(whitelistBlock).toContain("decide");
    expect(whitelistBlock).toContain("health");
  });

  it("orchestrator.ts calls chmodSync on the socket directory (belt-and-suspenders)", () => {
    const src = readFileSync(
      new URL("../../src/orchestrator/orchestrator.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("chmodSync");
  });

  it("security-limitations-v1.md documents the IPC limitation (B7)", () => {
    const doc = readFileSync(
      new URL("../../docs/security-limitations-v1.md", import.meta.url),
      "utf-8",
    );
    expect(doc).toContain("IPC");
    // Must mention the Unix socket mechanism
    expect(doc).toContain("domain socket");
  });
});

// ===========================================================================
// H7: sandbox check — provider "none" requires --force
// ===========================================================================

describe("H7 #519: sandbox check — provider 'none' requires --force", () => {
  it("exits 1 when provider is none and --force is omitted", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, YAML_NONE, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const code = await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(code).toBe(1);
  });

  it("stderr contains 'sandbox_check' audit tag when provider is none without --force", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, YAML_NONE, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderr.push(String(s));
      return true;
    });

    await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(stderr.join("")).toContain("sandbox_check");
  });

  it("stderr mentions '--force' when provider is none without --force (explains how to proceed)", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, YAML_NONE, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderr.push(String(s));
      return true;
    });

    await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(stderr.join("")).toContain("--force");
  });

  it("exits 0 when provider is none and --force is set", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, YAML_NONE, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const code = await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath, force: true });
    expect(code).toBe(0);
  });

  it("stdout contains 'No sandbox isolation active' when --force is set for provider none", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, YAML_NONE, "utf-8");

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath, force: true });
    expect(stdout.join("")).toContain("No sandbox isolation active");
  });

  it("checkDependencies is NOT called for provider none (no sandbox library needed)", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, YAML_NONE, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(sandboxMocks.mockCheckDeps).not.toHaveBeenCalled();
  });

  it("security-limitations-v1.md documents the 'none' provider risk (H7)", () => {
    const doc = readFileSync(
      new URL("../../docs/security-limitations-v1.md", import.meta.url),
      "utf-8",
    );
    expect(doc).toContain("none");
    expect(doc).toContain("sandbox_check");
    // Must mention full host privileges
    expect(doc).toContain("host");
  });

  it("bubblewrap provider: exits 0 when deps available (control: non-none provider still works)", async () => {
    sandboxMocks.mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, YAML_BUBBLEWRAP, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const code = await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(code).toBe(0);
  });
});
