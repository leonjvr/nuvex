/**
 * Tests for src/cli/apply-command.ts
 *
 * Covers:
 * - Missing config file → exit code 1 with error on stderr
 * - Dry-run with valid config → exit code 0, prints [dry-run] lines
 * - Dry-run with invalid config → exit code 1, prints validation errors
 * - Normal mode: apply() result drives exit code (0 on success, 1 on failure)
 * - Invalid --step name → exit code 1 with error message
 * - Valid --step is passed through to apply()
 * - Step name normalisation (case-insensitive)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApplyCommand } from "../../src/cli/apply-command.js";
import type { ApplyCommandOptions } from "../../src/cli/apply-command.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/apply/index.js", () => ({
  apply: vi.fn(),
}));

vi.mock("../../src/apply/validate.js", () => ({
  loadAndValidate: vi.fn(),
}));

vi.mock("../../src/apply/filesystem.js", () => ({
  planFilesystem: vi.fn(),
  executeFilesystemOps: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules
// ---------------------------------------------------------------------------

import { apply } from "../../src/apply/index.js";
import { loadAndValidate } from "../../src/apply/validate.js";
import { planFilesystem } from "../../src/apply/filesystem.js";

const mockApply = vi.mocked(apply);
const mockLoadAndValidate = vi.mocked(loadAndValidate);
const mockPlanFilesystem = vi.mocked(planFilesystem);

// ---------------------------------------------------------------------------
// Output capture helpers
// ---------------------------------------------------------------------------

let stdout = "";
let stderr = "";

function captureOutput(): void {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REAL_CONFIG_PATH = new URL("../../config/divisions.yaml", import.meta.url).pathname;

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-apply-cmd-test-"));
  captureOutput();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<ApplyCommandOptions> = {}): ApplyCommandOptions {
  return {
    config: "./divisions.yaml",
    dryRun: false,
    verbose: false,
    force: false,
    workDir: tmpDir,
    ...overrides,
  };
}

function makeApplyResult(success = true) {
  return {
    success,
    steps: [
      {
        step: "VALIDATE" as const,
        success,
        duration_ms: 10,
        summary: success ? "12 active" : "1 error",
      },
    ],
    config: {} as never,
    duration_ms: 100,
  };
}

// ---------------------------------------------------------------------------
// Missing config file
// ---------------------------------------------------------------------------

describe("runApplyCommand — missing config", () => {
  it("returns exit code 1 when config file does not exist", async () => {
    const code = await runApplyCommand(makeOpts({ config: "./nonexistent.yaml" }));
    expect(code).toBe(1);
  });

  it("writes error to stderr when config not found", async () => {
    await runApplyCommand(makeOpts({ config: "./nonexistent.yaml" }));
    expect(stderr).toContain("Error:");
    expect(stderr).toContain("not found");
  });

  it("does not call apply() when config missing", async () => {
    await runApplyCommand(makeOpts({ config: "./missing.yaml" }));
    expect(mockApply).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

describe("runApplyCommand — dry-run", () => {
  beforeEach(() => {
    // Write a real config for dry-run tests (resolved against tmpDir)
    const configPath = join(tmpDir, "divisions.yaml");
    const { readFileSync } = require("node:fs");
    writeFileSync(configPath, readFileSync(REAL_CONFIG_PATH, "utf-8"), "utf-8");

    mockLoadAndValidate.mockReturnValue({
      config: {
        activeDivisions: [{ code: "engineering" }, { code: "sales" }],
        divisions: [
          { code: "engineering", active: true },
          { code: "sales", active: true },
          { code: "hr", active: false },
        ],
        schema_version: "1.0",
        company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
        mode: "business",
        size_presets: { solo: { recommended: [], description: "Solo" } },
        sourcePath: "/tmp/test.yaml",
        contentHash: "abc123",
      },
      result: { valid: true, errors: [], warnings: [] },
    });

    mockPlanFilesystem.mockReturnValue([
      { type: "mkdir", path: "/a", overwrite: false },
      { type: "write", path: "/b.txt", overwrite: false },
      { type: "skip_existing", path: "/c.txt", overwrite: false },
    ]);
  });

  it("returns exit code 0 on valid config", async () => {
    const code = await runApplyCommand(makeOpts({ dryRun: true }));
    expect(code).toBe(0);
  });

  it("does not call apply() in dry-run mode", async () => {
    await runApplyCommand(makeOpts({ dryRun: true }));
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("prints [dry-run] lines to stdout", async () => {
    await runApplyCommand(makeOpts({ dryRun: true }));
    expect(stdout).toContain("[dry-run]");
  });

  it("dry-run stdout contains division counts", async () => {
    await runApplyCommand(makeOpts({ dryRun: true }));
    expect(stdout).toContain("active");
  });

  it("returns exit code 1 when validation fails in dry-run", async () => {
    mockLoadAndValidate.mockReturnValue({
      config: null,
      result: {
        valid: false,
        errors: [{ field: "schema_version", rule: "UNSUPPORTED", message: "unsupported version" }],
        warnings: [],
      },
    });

    const code = await runApplyCommand(makeOpts({ dryRun: true }));
    expect(code).toBe(1);
  });

  it("prints validation errors to stderr on failure", async () => {
    mockLoadAndValidate.mockReturnValue({
      config: null,
      result: {
        valid: false,
        errors: [{ field: "schema_version", rule: "UNSUPPORTED", message: "unsupported version" }],
        warnings: [],
      },
    });

    await runApplyCommand(makeOpts({ dryRun: true }));
    expect(stderr).toContain("Validation failed");
    expect(stderr).toContain("schema_version");
  });
});

// ---------------------------------------------------------------------------
// Normal apply mode
// ---------------------------------------------------------------------------

describe("runApplyCommand — normal mode", () => {
  beforeEach(() => {
    // Create the config file in tmpDir so existsSync passes
    writeFileSync(join(tmpDir, "divisions.yaml"), "schema_version: '1.0'\n", "utf-8");
  });

  it("returns exit code 0 on success", async () => {
    mockApply.mockResolvedValue(makeApplyResult(true));
    const code = await runApplyCommand(makeOpts());
    expect(code).toBe(0);
  });

  it("returns exit code 1 on apply failure", async () => {
    mockApply.mockResolvedValue(makeApplyResult(false));
    const code = await runApplyCommand(makeOpts());
    expect(code).toBe(1);
  });

  it("calls apply() with the correct configPath", async () => {
    mockApply.mockResolvedValue(makeApplyResult(true));
    await runApplyCommand(makeOpts({ config: "./divisions.yaml" }));
    const callArg = mockApply.mock.calls[0]?.[0];
    expect(callArg?.configPath).toContain("divisions.yaml");
  });

  it("passes verbose flag to apply()", async () => {
    mockApply.mockResolvedValue(makeApplyResult(true));
    await runApplyCommand(makeOpts({ verbose: true }));
    expect(mockApply.mock.calls[0]?.[0]?.verbose).toBe(true);
  });

  it("passes force flag to apply()", async () => {
    mockApply.mockResolvedValue(makeApplyResult(true));
    await runApplyCommand(makeOpts({ force: true }));
    expect(mockApply.mock.calls[0]?.[0]?.force).toBe(true);
  });

  it("prints apply result to stdout", async () => {
    mockApply.mockResolvedValue(makeApplyResult(true));
    await runApplyCommand(makeOpts());
    expect(stdout).toContain("Applied in");
  });
});

// ---------------------------------------------------------------------------
// --step flag
// ---------------------------------------------------------------------------

describe("runApplyCommand — --step flag", () => {
  beforeEach(() => {
    writeFileSync(join(tmpDir, "divisions.yaml"), "schema_version: '1.0'\n", "utf-8");
    mockApply.mockResolvedValue(makeApplyResult(true));
  });

  it("returns exit code 1 for invalid step name", async () => {
    const code = await runApplyCommand(makeOpts({ step: "INVALID_STEP" }));
    expect(code).toBe(1);
  });

  it("writes error to stderr for invalid step name", async () => {
    await runApplyCommand(makeOpts({ step: "BOGUS" }));
    expect(stderr).toContain("Invalid step");
    expect(stderr).toContain("BOGUS");
  });

  it("does not call apply() for invalid step name", async () => {
    await runApplyCommand(makeOpts({ step: "WRONG" }));
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("passes valid step name to apply()", async () => {
    await runApplyCommand(makeOpts({ step: "DATABASE" }));
    expect(mockApply.mock.calls[0]?.[0]?.step).toBe("DATABASE");
  });

  it("normalises lowercase step names to uppercase", async () => {
    await runApplyCommand(makeOpts({ step: "validate" }));
    expect(mockApply.mock.calls[0]?.[0]?.step).toBe("VALIDATE");
  });

  it("normalises mixed-case step names", async () => {
    await runApplyCommand(makeOpts({ step: "Filesystem" }));
    expect(mockApply.mock.calls[0]?.[0]?.step).toBe("FILESYSTEM");
  });

  it.each([
    "VALIDATE", "FILESYSTEM", "DATABASE", "SECRETS",
    "RBAC", "ROUTING", "SKILLS", "AUDIT", "COST_CENTERS", "FINALIZE",
  ])("accepts valid step '%s'", async (step) => {
    const code = await runApplyCommand(makeOpts({ step }));
    expect(code).toBe(0);
    expect(mockApply).toHaveBeenCalledOnce();
  });
});
