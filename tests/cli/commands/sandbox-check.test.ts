// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/sandbox.ts — runSandboxCheckCommand
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sandbox-runtime before importing sandbox module
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
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
    initialize:               mocks.mockInitialize,
    reset:                    mocks.mockReset,
    checkDependencies:        mocks.mockCheckDeps,
    getProxyPort:             mocks.mockGetProxy,
    getSocksProxyPort:        mocks.mockGetSocks,
    wrapWithSandbox:          mocks.mockWrapCmd,
    getSandboxViolationStore: mocks.mockGetStore,
  },
}));

// Import AFTER mock
import { runSandboxCheckCommand } from "../../../src/cli/commands/sandbox.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_YAML_NONE = `
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

const MINIMAL_YAML_BUBBLEWRAP = `
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

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-sandbox-cli-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("sandbox check — provider: none", () => {
  it("exits 1 when provider is none and --force is not set (H7 #519)", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, MINIMAL_YAML_NONE, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => {
      stderr.push(String(s));
      return true;
    });

    const code = await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(code).toBe(1);
    const errOutput = stderr.join("");
    // Must include sandbox_check audit string and advice to use --force
    expect(errOutput).toContain("sandbox_check");
    expect(errOutput).toContain("--force");
  });

  it("exits 0 when provider is none and --force is set (H7 #519)", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, MINIMAL_YAML_NONE, "utf-8");

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const code = await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath, force: true });
    expect(code).toBe(0);
    const output = stdout.join("");
    expect(output).toContain("Provider configured: none");
    expect(output).toContain("No sandbox isolation active");
  });

  it("does not call checkDependencies for provider none", async () => {
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, MINIMAL_YAML_NONE, "utf-8");

    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    // Without --force, returns 1 before reaching checkDependencies
    await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    // BubblewrapProvider.checkDependencies() would call SandboxManager.checkDependencies()
    expect(mocks.mockCheckDeps).not.toHaveBeenCalled();
  });
});

describe("sandbox check — provider: bubblewrap, deps available", () => {
  it("exits 0 when all dependencies are available", async () => {
    mocks.mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, MINIMAL_YAML_BUBBLEWRAP, "utf-8");

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });

    const code = await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(code).toBe(0);
    const output = stdout.join("");
    expect(output).toContain("Provider configured: bubblewrap");
    expect(output).toContain("Dependencies available: yes");
    expect(output).toContain("Ready for sandboxed agent execution.");
  });

  it("shows Docker capability note when deps are available", async () => {
    mocks.mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, MINIMAL_YAML_BUBBLEWRAP, "utf-8");

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });

    await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    const output = stdout.join("");
    expect(output).toContain("--cap-add=SYS_ADMIN");
  });
});

describe("sandbox check — provider: bubblewrap, deps missing", () => {
  it("exits 1 when dependencies are missing", async () => {
    mocks.mockCheckDeps.mockReturnValue({
      errors: ["bwrap not found", "socat not found"],
      warnings: [],
    });
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, MINIMAL_YAML_BUBBLEWRAP, "utf-8");

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });

    const code = await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    expect(code).toBe(1);
    const output = stdout.join("");
    expect(output).toContain("Dependencies available: no");
    expect(output).toContain("Missing: bwrap not found, socat not found");
  });

  it("shows install instructions when deps are missing", async () => {
    mocks.mockCheckDeps.mockReturnValue({ errors: ["bwrap not found"], warnings: [] });
    const cfgPath = join(tmpDir, "divisions.yaml");
    writeFileSync(cfgPath, MINIMAL_YAML_BUBBLEWRAP, "utf-8");

    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });

    await runSandboxCheckCommand({ workDir: tmpDir, config: cfgPath });
    const output = stdout.join("");
    expect(output).toContain("sudo apt install bubblewrap socat");
    expect(output).toContain("sudo apk add bubblewrap socat");
    expect(output).toContain("brew install bubblewrap");
  });
});

describe("sandbox check — no config file", () => {
  it("uses DEFAULT_SANDBOX_CONFIG (provider: none) when no config file exists — exits 1 without --force (H7 #519)", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const code = await runSandboxCheckCommand({
      workDir: tmpDir,                               // empty dir — no divisions.yaml
      config:  join(tmpDir, "divisions.yaml"),       // non-existent
    });
    // Provider "none" requires --force, so exits 1
    expect(code).toBe(1);
  });

  it("uses DEFAULT_SANDBOX_CONFIG (provider: none) when no config file exists — exits 0 with --force (H7 #519)", async () => {
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      stdout.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const code = await runSandboxCheckCommand({
      workDir: tmpDir,                               // empty dir — no divisions.yaml
      config:  join(tmpDir, "divisions.yaml"),       // non-existent
      force:   true,
    });
    expect(code).toBe(0);
    const output = stdout.join("");
    expect(output).toContain("Provider configured: none");
  });
});
