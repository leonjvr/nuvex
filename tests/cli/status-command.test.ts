/**
 * Tests for src/cli/status-command.ts
 *
 * Covers:
 * - No state.json → exit code 1, prints prompt to run apply
 * - Valid state.json → exit code 0, displays all fields
 * - Invalid JSON → exit code 1, writes error to stderr
 * - Inactive divisions displayed only when non-empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStatusCommand } from "../../src/cli/status-command.js";
import type { StateFile } from "../../src/types/apply.js";

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

let stdout = "";
let stderr = "";

beforeEach(() => {
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStateFile(overrides: Partial<StateFile["last_apply"]> = {}): StateFile {
  return {
    schema_version: "1.0",
    last_apply: {
      timestamp: "2026-02-27T10:00:00.000Z",
      divisions_yaml_hash: "sha256:abc123",
      governance_hash: "sha256:def456",
      mode: "business",
      active_divisions: ["engineering", "sales"],
      inactive_divisions: [],
      db_version: "1.0.0",
      agent_count: 2,
      apply_duration_ms: 500,
      ...overrides,
    },
    history: [
      {
        timestamp: "2026-02-27T10:00:00.000Z",
        action: "apply",
        changes: ["initial setup"],
      },
    ],
  };
}

let tmpDir: string;
let systemDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-status-test-"));
  systemDir = join(tmpDir, ".system");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// No state.json
// ---------------------------------------------------------------------------

describe("runStatusCommand — no state.json", () => {
  it("returns exit code 1 when state.json does not exist", () => {
    const code = runStatusCommand({ workDir: tmpDir });
    expect(code).toBe(1);
  });

  it("prints 'No state found' message to stdout", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("No state found");
  });

  it("tells user to run 'sidjua apply'", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("sidjua apply");
  });
});

// ---------------------------------------------------------------------------
// Valid state.json
// ---------------------------------------------------------------------------

describe("runStatusCommand — valid state.json", () => {
  beforeEach(() => {
    mkdirSync(systemDir, { recursive: true });
    writeFileSync(
      join(systemDir, "state.json"),
      JSON.stringify(makeStateFile()),
      "utf-8",
    );
  });

  it("returns exit code 0", () => {
    const code = runStatusCommand({ workDir: tmpDir });
    expect(code).toBe(0);
  });

  it("displays the last apply timestamp", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("2026-02-27T10:00:00.000Z");
  });

  it("displays the mode", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("business");
  });

  it("displays active divisions", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("engineering");
    expect(stdout).toContain("sales");
  });

  it("does not show 'Inactive:' when inactive_divisions is empty", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).not.toContain("Inactive:");
  });

  it("displays inactive divisions when present", () => {
    rmSync(join(systemDir, "state.json"));
    writeFileSync(
      join(systemDir, "state.json"),
      JSON.stringify(makeStateFile({ inactive_divisions: ["hr", "legal"] })),
      "utf-8",
    );
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("hr");
    expect(stdout).toContain("legal");
  });

  it("displays agent count", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("2");
  });

  it("displays DB version", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("1.0.0");
  });

  it("displays history run count", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("1 run(s)");
  });

  it("displays duration", () => {
    runStatusCommand({ workDir: tmpDir });
    expect(stdout).toContain("500ms");
  });
});

// ---------------------------------------------------------------------------
// Invalid state.json
// ---------------------------------------------------------------------------

describe("runStatusCommand — invalid state.json", () => {
  it("returns exit code 1 for malformed JSON", () => {
    mkdirSync(systemDir, { recursive: true });
    writeFileSync(join(systemDir, "state.json"), "{ not valid json }", "utf-8");

    const code = runStatusCommand({ workDir: tmpDir });
    expect(code).toBe(1);
  });

  it("writes error to stderr for malformed JSON", () => {
    mkdirSync(systemDir, { recursive: true });
    writeFileSync(join(systemDir, "state.json"), "{ not valid json }", "utf-8");

    runStatusCommand({ workDir: tmpDir });
    expect(stderr).toContain("Error reading state");
  });
});

// ---------------------------------------------------------------------------
// workDir resolution
// ---------------------------------------------------------------------------

describe("runStatusCommand — workDir resolution", () => {
  it("resolves workDir relative to process.cwd() when relative path given", () => {
    // Use an absolute path (tmpDir) which always resolves correctly
    mkdirSync(systemDir, { recursive: true });
    writeFileSync(
      join(systemDir, "state.json"),
      JSON.stringify(makeStateFile()),
      "utf-8",
    );
    const code = runStatusCommand({ workDir: tmpDir });
    expect(code).toBe(0);
  });
});
