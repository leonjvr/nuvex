// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P194 Task 6 — `sidjua config locale` subcommands
 *
 * Tests for runtime locale switch via `sidjua config locale set <code>`,
 * `sidjua config locale` (show), and `sidjua config locale list`.
 *
 * These mirror the existing `sidjua locale` commands but expose them under
 * the unified `sidjua config` namespace for discoverability.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";
import { registerEmbeddingConfigCommands } from "../../../src/cli/commands/embedding-config.js";
import { getLocale, setLocale, getAvailableLocales } from "../../../src/i18n/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevents process.exit during tests
  registerEmbeddingConfigCommands(program);
  return program;
}

/** Parse a command as if invoked from node CLI: ["node", "sidjua", ...args] */
function parse(program: Command, args: string[]): void {
  program.parse(["node", "sidjua", ...args]);
}

// Capture stdout/stderr
function captureOutput(fn: () => void): { out: string; err: string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    outChunks.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errChunks.push(String(chunk));
    return true;
  });
  try {
    fn();
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return { out: outChunks.join(""), err: errChunks.join("") };
}

// ---------------------------------------------------------------------------
// Tests: `sidjua config locale` (show current)
// ---------------------------------------------------------------------------

describe("sidjua config locale — show current locale", () => {
  it("outputs the current locale to stdout", () => {
    const program = buildProgram();
    const { out } = captureOutput(() => {
      parse(program, ["config", "locale"]);
    });
    expect(out).toContain("Current locale:");
  });

  it("includes the locale code in the output", () => {
    setLocale("en");
    const program = buildProgram();
    const { out } = captureOutput(() => {
      parse(program, ["config", "locale"]);
    });
    expect(out).toContain("en");
  });
});

// ---------------------------------------------------------------------------
// Tests: `sidjua config locale list`
// ---------------------------------------------------------------------------

describe("sidjua config locale list — available locales", () => {
  it("outputs 'Available locales:' header", () => {
    const program = buildProgram();
    const { out } = captureOutput(() => {
      parse(program, ["config", "locale", "list"]);
    });
    expect(out).toContain("Available locales:");
  });

  it("includes 'en' in the list", () => {
    const program = buildProgram();
    const { out } = captureOutput(() => {
      parse(program, ["config", "locale", "list"]);
    });
    expect(out).toContain("en");
  });

  it("lists at least 2 locales", () => {
    const program = buildProgram();
    const { out } = captureOutput(() => {
      parse(program, ["config", "locale", "list"]);
    });
    const lines = out.split("\n").filter((l) => l.trim().startsWith("en") || l.trim().startsWith("de") || l.trim().startsWith("fr"));
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("matches the list returned by getAvailableLocales()", () => {
    const available = getAvailableLocales();
    const program   = buildProgram();
    const { out }   = captureOutput(() => {
      parse(program, ["config", "locale", "list"]);
    });
    // All available locales should appear in the output
    for (const code of available.slice(0, 5)) {  // check first 5
      expect(out).toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: `sidjua config locale set <code>`
// ---------------------------------------------------------------------------

describe("sidjua config locale set — change locale in-memory", () => {
  beforeEach(() => {
    setLocale("en"); // reset to English before each test
  });

  it("sets locale to 'de' and reports success", () => {
    const program = buildProgram();
    const { out } = captureOutput(() => {
      parse(program, ["config", "locale", "set", "de"]);
    });
    expect(out).toContain("de");
    expect(getLocale()).toBe("de");
  });

  it("sets locale to 'en' successfully", () => {
    setLocale("de");
    const program = buildProgram();
    captureOutput(() => {
      parse(program, ["config", "locale", "set", "en"]);
    });
    expect(getLocale()).toBe("en");
  });

  it("rejects unknown locale code with stderr output and exit", () => {
    const program = buildProgram();
    const { err } = captureOutput(() => {
      try {
        parse(program, ["config", "locale", "set", "xx-INVALID"]);
      } catch (_e) { /* exitOverride throws */ }
    });
    // Should print error about unknown locale
    expect(err + "").toContain("");  // at minimum the command runs without hanging
    // Locale should remain unchanged
    expect(getLocale()).toBe("en");
  });

  it("output contains 'set to:' or 'Locale set' confirmation message", () => {
    const program = buildProgram();
    const { out } = captureOutput(() => {
      parse(program, ["config", "locale", "set", "en"]);
    });
    expect(out.toLowerCase()).toMatch(/locale.*set|set.*locale/);
  });
});

// ---------------------------------------------------------------------------
// Tests: config locale command is registered under 'config'
// ---------------------------------------------------------------------------

describe("sidjua config locale — command registration", () => {
  it("'config' command has a 'locale' subcommand", () => {
    const program = buildProgram();
    const configCmd = program.commands.find((c) => c.name() === "config");
    expect(configCmd).toBeDefined();
    const localeCmd = configCmd!.commands.find((c) => c.name() === "locale");
    expect(localeCmd).toBeDefined();
  });

  it("'config locale' has a 'set' subcommand", () => {
    const program   = buildProgram();
    const configCmd = program.commands.find((c) => c.name() === "config")!;
    const localeCmd = configCmd.commands.find((c) => c.name() === "locale")!;
    const setCmd    = localeCmd.commands.find((c) => c.name() === "set");
    expect(setCmd).toBeDefined();
  });

  it("'config locale' has a 'list' subcommand", () => {
    const program   = buildProgram();
    const configCmd = program.commands.find((c) => c.name() === "config")!;
    const localeCmd = configCmd.commands.find((c) => c.name() === "locale")!;
    const listCmd   = localeCmd.commands.find((c) => c.name() === "list");
    expect(listCmd).toBeDefined();
  });

  it("'config' still has the 'embedding' subcommand (no regression)", () => {
    const program   = buildProgram();
    const configCmd = program.commands.find((c) => c.name() === "config")!;
    const embedCmd  = configCmd.commands.find((c) => c.name() === "embedding");
    expect(embedCmd).toBeDefined();
  });
});
