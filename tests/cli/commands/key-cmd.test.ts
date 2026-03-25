/**
 * Tests for Phase 13d: `sidjua key` CLI commands
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { registerKeyCommands } from "../../../src/cli/commands/key.js";
import { ProviderKeyManager } from "../../../src/providers/key-manager.js";

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

describe("key CLI commands", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerKeyCommands(program);
    // Clear key manager state
    new ProviderKeyManager().clearCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("key list shows empty message when no refs registered", async () => {
    const cap = captureStdout();
    try {
      await program.parseAsync(["key", "list"], { from: "user" });
    } finally {
      cap.restore();
    }
    expect(cap.getOutput()).toContain("No key references");
  });

  it("key add registers a key ref and key list shows it", async () => {
    const cap1 = captureStdout();
    try {
      await program.parseAsync(
        ["key", "add", "test-ref", "--provider", "anthropic", "--source", "env:ANTHROPIC_API_KEY"],
        { from: "user" },
      );
    } finally {
      cap1.restore();
    }
    expect(cap1.getOutput()).toContain("test-ref");

    const cap2 = captureStdout();
    try {
      await program.parseAsync(["key", "list"], { from: "user" });
    } finally {
      cap2.restore();
    }
    expect(cap2.getOutput()).toContain("test-ref");
    expect(cap2.getOutput()).toContain("anthropic");
  });

  it("key remove deletes a ref", async () => {
    // Add (--allow-plaintext required when using literal: source)
    const capAdd = captureStdout();
    try {
      await program.parseAsync(
        ["key", "add", "removable-ref", "--provider", "openai", "--source", "literal:sk-test", "--allow-plaintext"],
        { from: "user" },
      );
    } finally {
      capAdd.restore();
    }

    // Remove
    const capRemove = captureStdout();
    try {
      await program.parseAsync(["key", "remove", "removable-ref"], { from: "user" });
    } finally {
      capRemove.restore();
    }
    expect(capRemove.getOutput()).toContain("removed");
  });

  it("key test resolves a literal key ref", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));

    // Add literal ref (--allow-plaintext required for literal: source)
    const capAdd = captureStdout();
    try {
      await program.parseAsync(
        ["key", "add", "literal-test", "--provider", "deepseek", "--source", "literal:sk-test-value", "--allow-plaintext"],
        { from: "user" },
      );
    } finally {
      capAdd.restore();
    }

    // Test
    const capTest = captureStdout();
    try {
      await program.parseAsync(["key", "test", "literal-test"], { from: "user" });
    } finally {
      capTest.restore();
    }

    const output = capTest.getOutput();
    expect(output).toContain("Resolved");
    // Key should be masked
    expect(output).not.toContain("sk-test-value");
  });
});
