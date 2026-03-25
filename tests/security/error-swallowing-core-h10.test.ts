// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for H10 Part 1/3 (#532 #519):
 *
 *   H10: Error swallowing cleanup — core modules
 *
 * Verifies that errors formerly swallowed with `void e` are now properly
 * logged with structured messages, correct severity levels, and context.
 *
 * Scope: src/core/, src/providers/, src/agent-lifecycle/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os   from "node:os";
import path from "node:path";
import fs   from "node:fs";

import {
  setGlobalLevel,
  resetLogger,
} from "../../src/core/logger.js";
import { BudgetTracker }  from "../../src/agent-lifecycle/budget-tracker.js";
import type { Database }  from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LogLine = { level: string; event: string; message: string; metadata?: unknown };

/**
 * Spy on both process.stdout.write and process.stderr.write and collect all
 * JSON log lines emitted during the callback execution.
 *
 * NOTE: The SIDJUA logger writes error/fatal entries to stderr and all other
 * levels to stdout. Both streams must be captured for complete coverage.
 */
async function captureLogLines(fn: () => void | Promise<void>): Promise<LogLine[]> {
  const lines: LogLine[] = [];

  function capture(chunk: string | Uint8Array): boolean {
    const s = typeof chunk === "string" ? chunk : chunk.toString();
    for (const line of s.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        lines.push(JSON.parse(trimmed) as LogLine);
      } catch { /* not JSON */ }
    }
    return true;
  }

  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(capture);
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(capture);
  try {
    await fn();
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return lines;
}

/** Make a minimal mock Database that throws on every prepare/exec call. */
function makeThrowingDb(message = "SQLITE_ERROR: no such table"): Database {
  return {
    prepare: vi.fn().mockImplementation(() => {
      throw new Error(message);
    }),
    exec: vi.fn().mockImplementation(() => {
      throw new Error(message);
    }),
    transaction: vi.fn().mockReturnValue(() => {}),
    pragma:      vi.fn(),
    close:       vi.fn(),
  } as unknown as Database;
}

// ===========================================================================
// Task 1: Structural verification — no naked void-e in scope
// ===========================================================================

describe("H10 structural: no bare void-e in core modules", () => {
  it("grep confirms zero void-e instances outside cleanup-ignore in src/core/", () => {
    // This test shells out to grep to confirm the grep-count is 0.
    // If a new void-e is added without a cleanup-ignore comment, this test will fail.
    const { execSync } = require("node:child_process");
    const count = parseInt(
      execSync(
        `grep -rn "void e\\b" src/core/ src/providers/ src/agent-lifecycle/ ` +
        `--include='*.ts' | grep -v '.test.' | grep -v '.d.ts' | grep -v 'cleanup-ignore' | wc -l`,
        { cwd: process.cwd(), encoding: "utf-8" },
      ).trim(),
      10,
    );
    expect(count).toBe(0);
  });

  it("cleanup-ignore annotations are present for legitimate swallows in logger.ts", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/logger.ts"),
      "utf-8",
    );
    // All void-e in logger.ts must be annotated with cleanup-ignore
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in logger.ts: ${line.trim()}`);
      }
    }
    // At least one cleanup-ignore must exist in logger.ts (sanity)
    expect(content).toContain("cleanup-ignore");
  });

  it("cleanup-ignore annotations are present for legitimate swallows in input-sanitizer.ts", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/input-sanitizer.ts"),
      "utf-8",
    );
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in input-sanitizer.ts: ${line.trim()}`);
      }
    }
  });

  it("logger is imported in budget-tracker, budget-resolver, agent-validator", () => {
    for (const file of [
      "src/agent-lifecycle/budget-tracker.ts",
      "src/agent-lifecycle/budget-resolver.ts",
      "src/agent-lifecycle/agent-validator.ts",
    ]) {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
      expect(content, `${file} should import createLogger`).toContain("createLogger");
      expect(content, `${file} should have logger instance`).toContain("const logger");
    }
  });
});

// ===========================================================================
// Task 2: CRITICAL — Budget enforcement DB failures log at ERROR level
// ===========================================================================

describe("H10 CRITICAL: BudgetTracker DB failures log at error level", () => {
  beforeEach(() => {
    setGlobalLevel("debug");
  });

  afterEach(() => {
    resetLogger();
  });

  it("getAgentMonthlySpend() logs error and returns Infinity on DB failure (fail closed)", async () => {
    const db = makeThrowingDb("cost_ledger table error");
    const tracker = new BudgetTracker(db);

    const lines = await captureLogLines(() => {
      const result = tracker.getAgentMonthlySpend("agent-123");
      expect(result).toBe(Number.POSITIVE_INFINITY); // fail closed — blocks overspend
    });

    const errorLine = lines.find(
      (l) => l.level === "error" && l.message.includes("Agent spend DB query failed"),
    );
    expect(errorLine).toBeDefined();
    expect(JSON.stringify(errorLine)).toContain("cost_ledger table error");
  });

  it("getAgentMonthlySpend() log entry includes structured error (not concatenated string)", async () => {
    const db = makeThrowingDb("structured-error-check");
    const tracker = new BudgetTracker(db);

    const lines = await captureLogLines(() => {
      tracker.getAgentMonthlySpend("agent-xyz");
    });

    const errorLine = lines.find((l) => l.level === "error");
    expect(errorLine).toBeDefined();
    // Must contain the error as a structured field, not concatenated in message
    const raw = JSON.stringify(errorLine);
    expect(raw).toContain("structured-error-check");
    // The message itself should NOT concatenate the error into it
    expect(errorLine!.message).not.toContain("structured-error-check");
  });

  it("getAgentDailySpend() logs error and returns Infinity on DB failure (fail closed)", async () => {
    const db = makeThrowingDb("daily-spend-table-missing");
    const tracker = new BudgetTracker(db);

    const lines = await captureLogLines(() => {
      const result = tracker.getAgentDailySpend("agent-daily");
      expect(result).toBe(Number.POSITIVE_INFINITY);
    });

    const errorLine = lines.find(
      (l) => l.level === "error" && l.message.includes("daily spend DB query failed"),
    );
    expect(errorLine).toBeDefined();
  });

  it("getOrgMonthlySpend() logs error and returns Infinity on DB failure (fail closed)", async () => {
    const db = makeThrowingDb("org-spend-table-missing");
    const tracker = new BudgetTracker(db);

    const lines = await captureLogLines(() => {
      const result = tracker.getOrgMonthlySpend();
      expect(result).toBe(Number.POSITIVE_INFINITY);
    });

    const errorLine = lines.find(
      (l) => l.level === "error" && l.message.includes("Org spend DB query failed"),
    );
    expect(errorLine).toBeDefined();
  });

  it("all three budget DB failures log at error level with fail-closed context", async () => {
    const db = makeThrowingDb("budget-error");
    const tracker = new BudgetTracker(db);

    const lines = await captureLogLines(() => {
      tracker.getAgentMonthlySpend("a");
      tracker.getAgentDailySpend("a");
      tracker.getOrgMonthlySpend();
    });

    const errorLines = lines.filter((l) => l.level === "error");
    expect(errorLines.length).toBeGreaterThanOrEqual(3);

    // Each error line should mention fail closed or DB query failure
    for (const line of errorLines) {
      expect(line.message).toMatch(/fail closed|DB query failed/i);
    }
  });
});

// ===========================================================================
// Task 3: CRITICAL — Budget resolver DB failures log at ERROR level
// ===========================================================================

describe("H10 CRITICAL: BudgetResolver source file has logger.error calls", () => {
  it("budget-resolver.ts contains logger.error for each budget DB failure", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/agent-lifecycle/budget-resolver.ts"),
      "utf-8",
    );

    // Each of the 4 level checker failures should have logger.error
    // (getMonthlySpend propagates errors to the caller's catch block instead)
    const errorCalls = (content.match(/logger\.error\(/g) ?? []).length;
    expect(errorCalls).toBeGreaterThanOrEqual(4);

    // The messages should indicate fail-closed behaviour
    expect(content).toContain("fail-closed");
    expect(content).toContain("logger.error");
  });

  it("budget-resolver.ts uses structured error objects not string concatenation", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/agent-lifecycle/budget-resolver.ts"),
      "utf-8",
    );

    // Check for structured error pattern: `e instanceof Error ? e.message : String(e)`
    expect(content).toContain("e instanceof Error ? e.message : String(e)");

    // Should NOT use template literal concatenation in logger calls
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("logger.error") || line.includes("logger.warn")) {
        // These lines should not contain `${e}` or `+ e`
        expect(line, `Structured error expected in: ${line.trim()}`).not.toMatch(/`[^`]*\$\{e\}[^`]*`/);
      }
    }
  });
});

// ===========================================================================
// Task 4: CRITICAL — Provider setup health status update logs at ERROR
// ===========================================================================

describe("H10 CRITICAL: provider-setup.ts health status update failure", () => {
  it("provider-setup.ts contains logger.error for health status DB write failure", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/agent-lifecycle/provider-setup.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.error");
    expect(content).toContain("Provider health status update failed");
    // Should no longer have bare void e for health status
    const lines = content.split("\n");
    const healthStatusSection = lines.findIndex((l) => l.includes("updateHealthStatus"));
    const relevantLines = lines.slice(healthStatusSection, healthStatusSection + 20);
    const hasVoidEWithoutCleanup = relevantLines.some(
      (l) => l.includes("void e") && !l.includes("cleanup-ignore"),
    );
    expect(hasVoidEWithoutCleanup).toBe(false);
  });
});

// ===========================================================================
// Task 5: WARN — Agent validator DB failures log at warn level
// ===========================================================================

describe("H10 WARN: agent-validator.ts DB failures log at warn level", () => {
  it("agent-validator.ts contains logger.warn for DB query failures", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/agent-lifecycle/agent-validator.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    // At least the provider config, model validation, and division validation failures
    expect(content).toContain("Provider config DB query failed");
    expect(content).toContain("Model validation DB query failed");
    expect(content).toContain("Division validation DB query failed");
  });

  it("agent-validator.ts uses logger.debug for pre-migration table-missing cases", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/agent-lifecycle/agent-validator.ts"),
      "utf-8",
    );

    // Pre-migration guards should be DEBUG, not WARN or ERROR
    expect(content).toContain("pre-migration");
    expect(content).toContain("logger.debug");
  });
});

// ===========================================================================
// Task 6: WARN/DEBUG — Key manager failures use appropriate levels
// ===========================================================================

describe("H10 WARN: key-manager.ts failures log with appropriate levels", () => {
  it("key-manager.ts logs warn for key resolution and validation failures", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/providers/key-manager.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    // Key validation failures should be WARN
    expect(content).toContain("Key reference resolution failed");
    expect(content).toContain("Provider ping failed during key validation");
    expect(content).toContain("Named key validation failed");
  });

  it("key-manager.ts logs debug for .env file not readable (expected condition)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/providers/key-manager.ts"),
      "utf-8",
    );

    // .env missing is a normal state — should be DEBUG not WARN
    expect(content).toContain("logger.debug");
    expect(content).toContain(".env file not readable");
  });
});

// ===========================================================================
// Task 7: Governance rule-loader uses DEBUG for file system operations
// ===========================================================================

describe("H10 DEBUG: rule-loader.ts uses debug for filesystem operations", () => {
  it("rule-loader.ts logs debug for governance directory read failures", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/governance/rule-loader.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.debug");
    expect(content).toContain("Could not read governance directory");
  });

  it("rule-loader.ts has cleanup-ignore for file-vs-directory detection", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/governance/rule-loader.ts"),
      "utf-8",
    );

    // The file-vs-dir detection catch is cleanup-ignore
    expect(content).toContain("cleanup-ignore");
  });
});

// ===========================================================================
// Task 8: Update check uses appropriate severity levels
// ===========================================================================

describe("H10 WARN/DEBUG: update-check.ts uses appropriate severity levels", () => {
  it("update-check.ts logs warn for cache write failure (unexpected but non-fatal)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/update/update-check.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("Update cache write failed");
    expect(content).toContain("Startup update check failed");
  });

  it("update-check.ts logs debug for cache read failure (expected: malformed cache)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/update/update-check.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.debug");
    expect(content).toContain("Update cache read failed");
  });
});

// ===========================================================================
// Task 9: Budget tracker pre-migration guards use DEBUG level
// ===========================================================================

describe("H10 DEBUG: budget-tracker.ts pre-migration guards use debug level", () => {
  it("budget-tracker.ts uses debug for table-not-found cases (pre-migration)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/agent-lifecycle/budget-tracker.ts"),
      "utf-8",
    );

    expect(content).toContain("pre-migration");
    // Table-missing is expected before migration runs — should be DEBUG not ERROR
    const debugCalls = (content.match(/logger\.debug\(/g) ?? []).length;
    expect(debugCalls).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// Task 10: Embedding source uses debug for metadata parse failures
// ===========================================================================

describe("H10 DEBUG: embedding-source.ts uses debug for metadata parse failures", () => {
  it("embedding-source.ts logs debug for chunk metadata JSON parse failures", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/knowledge/embedding-source.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.debug");
    expect(content).toContain("Chunk metadata JSON parse failed");
    expect(content).toContain("using empty object");
  });
});
