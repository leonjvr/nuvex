/**
 * Tests for Phase 13d: `sidjua setup` CLI commands
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerSetupCommands } from "../../../src/cli/commands/setup.js";
import { resetDefaultCatalog } from "../../../src/providers/catalog.js";

// ---------------------------------------------------------------------------
// stdout capture helper
// ---------------------------------------------------------------------------

function captureStdout(): { getOutput: () => string; restore: () => void } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  return {
    getOutput: () => chunks.join(""),
    restore:   () => { process.stdout.write = original; },
  };
}

describe("setup CLI commands", () => {
  let program: Command;

  beforeEach(() => {
    resetDefaultCatalog();
    delete process.env["CLOUDFLARE_ACCOUNT_ID"];
    delete process.env["CLOUDFLARE_AI_API_KEY"];
    program = new Command();
    program.exitOverride();
    registerSetupCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sidjua setup (default) shows quick-start doc", async () => {
    const cap = captureStdout();
    try {
      await program.parseAsync(["setup"], { from: "user" });
    } finally {
      cap.restore();
    }

    const output = cap.getOutput();
    // Should show some meaningful setup content
    expect(output.length).toBeGreaterThan(10);
  });

  it("sidjua setup --ask falls back to docs when assistant unavailable", async () => {
    // No Cloudflare credentials → assistant unavailable → doc fallback
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("should not call")));

    const cap = captureStdout();
    try {
      await program.parseAsync(["setup", "--ask", "how do I add a provider?"], { from: "user" });
    } finally {
      cap.restore();
    }

    const output = cap.getOutput();
    expect(output.length).toBeGreaterThan(10);
    // Should indicate offline mode
    expect(output).toContain("Offline");
  });

  it("sidjua setup --validate shows output for default config", async () => {
    // Default catalog has builtins; all cloud providers have models.
    // Local providers have empty models (expected), so no issues.
    // There may be warnings about cloud-only config.
    const cap = captureStdout();
    try {
      await program.parseAsync(["setup", "--validate"], { from: "user" });
    } finally {
      cap.restore();
    }

    const output = cap.getOutput();
    // Should produce some output (either "looks good" or warnings)
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });
});
