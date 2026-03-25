/**
 * Tests for Phase 13d: `sidjua provider` CLI commands
 *
 * Tests the registration and basic behavior of provider command functions.
 * Uses stdout capture instead of spawning a child process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerProviderCommands } from "../../../src/cli/commands/provider.js";
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

describe("provider CLI commands", () => {
  let program: Command;

  beforeEach(() => {
    resetDefaultCatalog();
    program = new Command();
    program.exitOverride(); // prevent process.exit in tests
    registerProviderCommands(program);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("provider list should show builtin providers", async () => {
    const cap = captureStdout();
    try {
      await program.parseAsync(["provider", "list"], { from: "user" });
    } finally {
      cap.restore();
    }

    const output = cap.getOutput();
    expect(output).toContain("anthropic");
    expect(output).toContain("deepseek");
    expect(output).toContain("ollama");
  });

  it("provider list --cloud shows only cloud providers", async () => {
    const cap = captureStdout();
    try {
      await program.parseAsync(["provider", "list", "--cloud"], { from: "user" });
    } finally {
      cap.restore();
    }

    const output = cap.getOutput();
    expect(output).toContain("anthropic");
    expect(output).not.toContain("ollama"); // local provider
  });

  it("provider models shows model details for a provider", async () => {
    const cap = captureStdout();
    try {
      await program.parseAsync(["provider", "models", "anthropic"], { from: "user" });
    } finally {
      cap.restore();
    }

    const output = cap.getOutput();
    expect(output).toContain("claude-sonnet-4-6");
    expect(output).toContain("200k");
  });

  it("provider models exits with error for unknown provider", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    const cap = captureStdout();
    try {
      await program.parseAsync(["provider", "models", "nonexistent"], { from: "user" });
    } catch {
      // expected error from mocked exit
    } finally {
      cap.restore();
    }

    // Check before restoring (mockRestore clears call records)
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});
