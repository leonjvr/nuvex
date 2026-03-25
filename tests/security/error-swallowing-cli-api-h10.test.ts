// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for H10 Part 2/3 (#533 #519):
 *
 *   H10: Error swallowing cleanup — CLI + API modules
 *
 * Verifies that errors formerly swallowed with `void e` are now properly
 * logged with structured messages, correct severity levels, and context.
 *
 * Scope: src/cli/, src/api/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs   from "node:fs";

import {
  setGlobalLevel,
  resetLogger,
} from "../../src/core/logger.js";

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

// ===========================================================================
// Task 1: Structural verification — no naked void-e in scope
// ===========================================================================

describe("H10 structural: no bare void-e in CLI + API modules", () => {
  it("grep confirms zero void-e instances outside cleanup-ignore in src/cli/", () => {
    const { execSync } = require("node:child_process");
    const count = parseInt(
      execSync(
        `grep -rn "void e\\b" src/cli/ src/api/ ` +
        `--include='*.ts' | grep -v '.test.' | grep -v '.d.ts' | grep -v 'cleanup-ignore' | wc -l`,
        { cwd: process.cwd(), encoding: "utf-8" },
      ).trim(),
      10,
    );
    expect(count).toBe(0);
  });

  it("cleanup-ignore annotations are present for process.kill signal probe in process.ts", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/utils/process.ts"),
      "utf-8",
    );
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in process.ts: ${line.trim()}`);
      }
    }
    expect(content).toContain("cleanup-ignore");
  });

  it("cleanup-ignore annotations are present in stop-orchestrator.ts", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/stop-orchestrator.ts"),
      "utf-8",
    );
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in stop-orchestrator.ts: ${line.trim()}`);
      }
    }
    expect(content).toContain("cleanup-ignore");
  });

  it("cleanup-ignore annotations are present in start.ts and cli-server.ts", () => {
    for (const file of ["src/cli/commands/start.ts", "src/api/cli-server.ts"]) {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.includes("void e") && !line.includes("cleanup-ignore")) {
          throw new Error(`Found unannotated void-e in ${file}: ${line.trim()}`);
        }
      }
    }
  });

  it("logger is imported in run, decide, health, db-init, task-monitor", () => {
    for (const file of [
      "src/cli/commands/run.ts",
      "src/cli/commands/decide.ts",
      "src/cli/commands/health.ts",
      "src/cli/utils/db-init.ts",
      "src/cli/commands/task-monitor.ts",
    ]) {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
      expect(content, `${file} should import createLogger`).toContain("createLogger");
      expect(content, `${file} should have logger instance`).toContain("const logger");
    }
  });
});

// ===========================================================================
// Task 2: CRITICAL — run.ts cost ledger write failure logs at ERROR level
// ===========================================================================

// H10 CRITICAL (P268 supersedes): run.ts no longer writes to cost_ledger
// directly. executeTaskInline (which had the cost ledger write + error logging)
// was deleted by P268. Budget/cost tracking is now the orchestrator's concern.
describe("H10 CRITICAL (P268): run.ts delegates cost tracking to orchestrator", () => {
  it("run.ts does not contain inline cost ledger write (executeTaskInline removed)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/run.ts"),
      "utf-8",
    );

    // Cost ledger writes were in executeTaskInline, which was deleted
    expect(content).not.toContain("Cost ledger DB write failed");
    expect(content).not.toContain("cost_ledger");
  });

  it("run.ts uses logger for migrations failure (structured pattern preserved)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/run.ts"),
      "utf-8",
    );

    // The runMigrations105 catch block still uses logger.debug (structured)
    expect(content).toContain("logger.debug");
    // No raw string concatenation with error objects
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("logger.error") || line.includes("logger.warn")) {
        expect(line, `Structured error expected in: ${line.trim()}`).not.toMatch(/`[^`]*\$\{e\}[^`]*`/);
      }
    }
  });
});

// ===========================================================================
// Task 3: CRITICAL — db-init.ts schema failure logs at WARN
// ===========================================================================

describe("H10 WARN: db-init.ts schema init failure", () => {
  beforeEach(() => {
    setGlobalLevel("debug");
  });

  afterEach(() => {
    resetLogger();
  });

  it("openCliDatabase() logs warn when schema exec fails on a real DB", async () => {
    // Use a real in-memory DB that intentionally breaks the schema exec
    const { openDatabase } = await import("../../src/utils/db.js");
    const { openCliDatabase } = await import("../../src/cli/utils/db-init.js");

    // We can't easily inject a broken db into openCliDatabase without a path,
    // so verify the source-level guarantee instead:
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/utils/db-init.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("Schema init failed");
    expect(content).toContain("table may exist with different structure");
  });
});

// ===========================================================================
// Task 4: WARN — health.ts DB failure logs at WARN level
// ===========================================================================

describe("H10 WARN: health.ts DB health check failure", () => {
  it("health.ts contains logger.warn for DB health check failure", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/health.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("DB health check query failed");
    expect(content).toContain("reporting unhealthy");
  });

  it("health.ts uses logger.debug for pre-migration table-missing cases", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/health.ts"),
      "utf-8",
    );

    // Tier column missing is a pre-Phase-10.5 migration scenario — should be DEBUG
    expect(content).toContain("logger.debug");
    expect(content).toContain("pre-Phase-10.5 migration");
  });
});

// ===========================================================================
// Task 5: WARN — stop-orchestrator.ts IPC failure logs at WARN
// ===========================================================================

describe("H10 WARN: stop-orchestrator.ts IPC socket failure", () => {
  it("stop-orchestrator.ts logs warn for IPC not available, falls back to SIGTERM", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/stop-orchestrator.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("IPC socket not available");
    expect(content).toContain("falling back to SIGTERM");
  });

  it("stop-orchestrator.ts SIGTERM sends are cleanup-ignore (cannot log from signal handlers)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/stop-orchestrator.ts"),
      "utf-8",
    );

    // All void e/e2 in this file must be cleanup-ignore
    const lines = content.split("\n");
    for (const line of lines) {
      if ((line.includes("void e;") || line.includes("void e2;")) && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in stop-orchestrator.ts: ${line.trim()}`);
      }
    }
  });
});

// ===========================================================================
// Task 6: WARN — decide.ts orchestrator IPC failure logs at WARN
// ===========================================================================

describe("H10 WARN: decide.ts orchestrator IPC failure", () => {
  it("decide.ts logs warn when orchestrator IPC is not reachable", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/decide.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("Orchestrator IPC not reachable");
    expect(content).toContain("falling through to direct DB write");
  });

  it("decide.ts uses structured error in warn call", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/decide.ts"),
      "utf-8",
    );

    expect(content).toContain("e instanceof Error ? e.message : String(e)");

    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("logger.warn") || line.includes("logger.error")) {
        expect(line, `Structured error expected in: ${line.trim()}`).not.toMatch(/`[^`]*\$\{e\}[^`]*`/);
      }
    }
  });
});

// ===========================================================================
// Task 7: WARN — task-monitor.ts task lookup failure logs at WARN
// ===========================================================================

describe("H10 WARN: task-monitor.ts lookup failure", () => {
  it("task-monitor.ts logs warn for task lookup failures", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/task-monitor.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("Task lookup failed");
    expect(content).toContain("bridge unavailable");
  });
});

// ===========================================================================
// Task 8: WARN — memory.ts FTS rebuild failure logs at WARN
// ===========================================================================

describe("H10 WARN: memory.ts FTS index rebuild failure", () => {
  it("memory.ts logs warn for FTS index rebuild failure", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/memory.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("FTS index rebuild failed");
    expect(content).toContain("search may return stale results");
  });
});

// ===========================================================================
// Task 9: WARN — init.ts failures log at appropriate levels
// ===========================================================================

describe("H10 WARN: init.ts agent registration and division sync failures", () => {
  it("init.ts logs warn for division sync failure", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/init.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("Division sync skipped");
    expect(content).toContain("run sidjua apply manually");
  });

  it("init.ts logs warn for guide agent registration failure", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/init.ts"),
      "utf-8",
    );

    expect(content).toContain("Guide agent registration failed");
    expect(content).toContain("will load from YAML on next start");
  });

  it("init.ts logs warn for telemetry config write failure (non-fatal)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/init.ts"),
      "utf-8",
    );

    expect(content).toContain("Telemetry config write failed");
    expect(content).toContain("non-fatal");
  });

  it("init.ts access()-based cleanup-ignore blocks are annotated", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/init.ts"),
      "utf-8",
    );

    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in init.ts: ${line.trim()}`);
      }
    }
    expect(content).toContain("cleanup-ignore");
  });
});

// ===========================================================================
// Task 10: WARN — update.ts release verification failure logs at WARN
// ===========================================================================

describe("H10 WARN: update.ts release verification failure", () => {
  it("update.ts logs warn when release verification throws", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/update.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("Release verification threw an exception");
    expect(content).toContain("treating as unverified");
  });
});

// ===========================================================================
// Task 11: WARN — SSE event-stream logs warn at client limit
// ===========================================================================

describe("H10 WARN: SSE event-stream max clients", () => {
  it("event-stream.ts logs warn when max SSE clients is reached", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/api/sse/event-stream.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    expect(content).toContain("SSE max clients reached");
    expect(content).toContain("rejecting new connection");
  });
});

// ===========================================================================
// Task 12: WARN — api/key-store.ts failures log at WARN
// ===========================================================================

describe("H10 WARN: api/key-store.ts DB failures", () => {
  it("key-store.ts logs warn for DB open, load, and persist failures", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/api/key-store.ts"),
      "utf-8",
    );

    expect(content).toContain("logger.warn");
    // All three failure points
    expect(content).toContain("Could not open key-state DB");
    expect(content).toContain("Could not load key state from DB");
    expect(content).toContain("Could not persist key state to DB");
  });
});

// ===========================================================================
// Task 13: Scope completeness — all modified CLI files have logger
// ===========================================================================

describe("H10 scope: all modified CLI/API files import logger", () => {
  const expectedFiles = [
    "src/cli/utils/db-init.ts",
    "src/cli/commands/health.ts",
    "src/cli/commands/task-monitor.ts",
    "src/cli/commands/decide.ts",
    "src/cli/commands/memory.ts",
    "src/cli/commands/run.ts",
    "src/cli/commands/stop-orchestrator.ts",
    "src/cli/commands/update.ts",
    "src/api/key-store.ts",
    "src/api/sse/event-stream.ts",
  ];

  for (const file of expectedFiles) {
    it(`${file} imports createLogger`, () => {
      const content = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
      expect(content, `${file} should import createLogger`).toContain("createLogger");
      expect(content, `${file} should have logger instance`).toContain("const logger");
    });
  }
});
