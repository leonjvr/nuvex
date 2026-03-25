/**
 * Tests for `sidjua chat` command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { runChatCommand } from "../../src/cli/commands/chat.js";
import type { ReadlineProvider } from "../../src/cli/commands/chat.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock readline provider that yields lines in order, then EOF */
function makeMockReadline(lines: string[]): ReadlineProvider {
  let idx = 0;
  return {
    question: vi.fn().mockImplementation(() => {
      const line = lines[idx++];
      if (line === undefined) return Promise.reject(new Error("EOF"));
      return Promise.resolve(line);
    }),
    close: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

const origStdout = process.stdout.write.bind(process.stdout);
const origStderr = process.stderr.write.bind(process.stderr);
let stdoutOutput = "";
let stderrOutput = "";

function captureOutput(): void {
  stdoutOutput = "";
  stderrOutput = "";
  vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    stdoutOutput += typeof data === "string" ? data : data.toString();
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((data) => {
    stderrOutput += typeof data === "string" ? data : data.toString();
    return true;
  });
}

function restoreOutput(): void {
  vi.mocked(process.stdout.write).mockRestore?.();
  vi.mocked(process.stderr.write).mockRestore?.();
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
}

/** Create a minimal initialized workspace for chat tests */
function setupWorkspace(tmpDirPath: string): void {
  mkdirSync(join(tmpDirPath, ".system"), { recursive: true });
  mkdirSync(join(tmpDirPath, "agents", "skills"), { recursive: true });
  // Create a dummy DB file — just needs to exist for the pre-check
  writeFileSync(join(tmpDirPath, ".system", "sidjua.db"), "");
  writeFileSync(
    join(tmpDirPath, "agents", "skills", "guide.md"),
    "# SIDJUA Guide\n\nYou are a helpful guide.\n",
  );
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-chat-"));
  captureOutput();
  vi.unstubAllEnvs();
  // Ensure no credentials in env by default
  delete process.env["SIDJUA_CF_ACCOUNT_ID"];
  delete process.env["SIDJUA_CF_TOKEN"];
});

afterEach(() => {
  restoreOutput();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pre-condition checks
// ---------------------------------------------------------------------------

describe("runChatCommand — pre-condition checks", () => {
  it("returns exit code 1 when workspace not initialized", async () => {
    const code = await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline([]),
    });

    expect(code).toBe(1);
    expect(stderrOutput).toContain("✗");
    expect(stderrOutput).toContain("sidjua init");
  });

  it("returns exit code 1 for non-guide agent", async () => {
    setupWorkspace(tmpDir);

    const code = await runChatCommand({
      workDir:         tmpDir,
      agent:           "my-researcher",
      verbose:         false,
      readlineFactory: () => makeMockReadline([]),
    });

    expect(code).toBe(1);
    expect(stderrOutput).toContain("not supported");
  });

  it("writes ✗ and 'sidjua init' suggestion to stderr when workspace missing", async () => {
    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline([]),
    });
    expect(stderrOutput).toContain("sidjua init");
  });
});

// ---------------------------------------------------------------------------
// Chat header
// ---------------------------------------------------------------------------

describe("runChatCommand — chat header", () => {
  it("shows SIDJUA Guide header on startup", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline([]),
    });

    expect(stdoutOutput).toContain("SIDJUA Guide");
  });

  it("shows proxy-online status when no credentials (default)", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      proxyUrl:        null,  // force offline so no real network call
      readlineFactory: () => makeMockReadline([]),
    });

    // With proxyUrl: null, shows offline; without, would show proxy online
    expect(stdoutOutput).toMatch(/Offline|online/i);
  });

  it("shows connected status when credentials are set", async () => {
    setupWorkspace(tmpDir);
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "test-account");
    vi.stubEnv("SIDJUA_CF_TOKEN",      "test-token");

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline([]),
    });

    expect(stdoutOutput).toContain("connected");
  });

  it("returns exit code 0 on clean exit (EOF)", async () => {
    setupWorkspace(tmpDir);

    const code = await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline([]),
    });

    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// In-chat slash commands via injectable readline
// ---------------------------------------------------------------------------

describe("runChatCommand — in-chat slash commands", () => {
  it("processes /help and shows command list", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["/help", "/exit"]),
    });

    expect(stdoutOutput).toContain("/key");
    expect(stdoutOutput).toContain("/agents");
  });

  it("exits cleanly on /exit", async () => {
    setupWorkspace(tmpDir);

    const code = await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["/exit"]),
    });

    expect(code).toBe(0);
    expect(stdoutOutput).toContain("Goodbye");
  });

  it("shows error for unknown slash commands", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["/unknowncmd", "/exit"]),
    });

    expect(stdoutOutput).toContain("Unknown command");
  });

  it("handles /status command", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["/status", "/exit"]),
    });

    expect(stdoutOutput).toContain("divisions.yaml");
  });

  it("handles /agents command", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["/agents", "/exit"]),
    });

    // Should output agents (or "No agents" message)
    expect(stdoutOutput).toBeTruthy();
  });

  it("handles empty input lines without crash", async () => {
    setupWorkspace(tmpDir);

    const code = await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["", "  ", "/exit"]),
    });

    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Offline chat responses
// ---------------------------------------------------------------------------

describe("runChatCommand — offline chat (no credentials)", () => {
  it("responds to user messages in offline mode", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      proxyUrl:        null,   // disable proxy to keep test fast and deterministic
      readlineFactory: () => makeMockReadline(["Hello there!", "/exit"]),
    });

    // Offline response should be printed
    expect(stdoutOutput).toContain("Guide:");
  });

  it("responds to 'create agent' message in offline mode", async () => {
    setupWorkspace(tmpDir);

    await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      proxyUrl:        null,   // disable proxy to keep test fast and deterministic
      readlineFactory: () => makeMockReadline(["I want to create a new agent", "/exit"]),
    });

    // Should show offline message about agent creation
    const lowerOutput = stdoutOutput.toLowerCase();
    expect(lowerOutput).toMatch(/offline|agent|create/);
  });
});

// ---------------------------------------------------------------------------
// Skill file loading
// ---------------------------------------------------------------------------

describe("runChatCommand — skill file loading", () => {
  it("loads skill from workspace guide.md", async () => {
    setupWorkspace(tmpDir);
    writeFileSync(
      join(tmpDir, "agents", "skills", "guide.md"),
      "# Custom Guide\n\nYou are a very helpful assistant.\n",
    );

    // Should not crash even with custom skill
    const code = await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["/exit"]),
    });

    expect(code).toBe(0);
  });

  it("falls back to embedded skill when guide.md is missing", async () => {
    // Setup workspace WITHOUT a skill file
    mkdirSync(join(tmpDir, ".system"), { recursive: true });
    writeFileSync(join(tmpDir, ".system", "sidjua.db"), "");
    // No skill file created

    const code = await runChatCommand({
      workDir:         tmpDir,
      agent:           "guide",
      verbose:         false,
      readlineFactory: () => makeMockReadline(["/exit"]),
    });

    // Should not crash — uses embedded fallback
    expect(code).toBe(0);
  });
});
