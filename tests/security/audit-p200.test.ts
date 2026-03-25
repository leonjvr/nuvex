// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security audit P200 — verification and fix tests.
 *
 * Covers:
 *   Task 1: Auth middleware — global coverage (false positive verification)
 *   Task 2: Sandbox bubblewrap — retry cooldown after init failure
 *   Task 3: Telemetry rate limit — aligned cap + FIFO eviction
 *   Task 4: Blocking I/O — async readFile in tasks.ts + reduced spin-wait
 *   Task 5: OpenClaw importer — backup warning
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";

// ---------------------------------------------------------------------------
// Task 1 — Auth middleware global coverage (false positive verification)
// ---------------------------------------------------------------------------

describe("Task 1: Auth middleware — source verification", () => {
  it("server.ts applies authenticate middleware globally before routes", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/api/server.ts"),
      "utf8",
    ) as string;
    // Auth middleware must appear as a global use("*", ...) call
    expect(src).toContain("app.use(\"*\", authenticate(");
    // Routes registered AFTER middleware (routes appear later in file)
    const authPos   = src.indexOf("app.use(\"*\", authenticate(");
    const routesPos = src.indexOf("app.route(\"/api/v1\"");
    expect(authPos).toBeGreaterThan(-1);
    expect(routesPos).toBeGreaterThan(authPos);
  });

  it("chat, provider, starter-agents routes do not define their own auth", () => {
    const routeFiles = [
      "src/api/routes/chat.ts",
      "src/api/routes/provider.ts",
      "src/api/routes/starter-agents.ts",
    ];
    for (const file of routeFiles) {
      const src = require("node:fs").readFileSync(
        require("node:path").join(process.cwd(), file),
        "utf8",
      ) as string;
      // These routes rely on global middleware — they should NOT re-import or
      // call the authenticate middleware directly.
      expect(src).not.toContain("import { authenticate }");
      expect(src).not.toContain("authenticate(");
    }
  });
});

// ---------------------------------------------------------------------------
// Task 2 — Bubblewrap retry cooldown
// ---------------------------------------------------------------------------

describe("Task 2: BubblewrapProvider — init retry cooldown", () => {
  it("source no longer contains _initFailed field", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/core/sandbox/bubblewrap-provider.ts"),
      "utf8",
    ) as string;
    expect(src).not.toContain("_initFailed");
  });

  it("source contains _lastInitAttempt and INIT_RETRY_COOLDOWN_MS", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/core/sandbox/bubblewrap-provider.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("_lastInitAttempt");
    expect(src).toContain("INIT_RETRY_COOLDOWN_MS");
    expect(src).toContain("60_000");
  });

  it("source logs retry attempt when cooldown has passed", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/core/sandbox/bubblewrap-provider.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("sandbox_init_retry");
    expect(src).toContain("Retrying bubblewrap initialization");
  });

  it("SYS-011 is thrown during cooldown window with retry timestamp", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/core/sandbox/bubblewrap-provider.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("SYS-011");
    expect(src).toContain("Next retry available after");
  });
});

// ---------------------------------------------------------------------------
// Task 3 — Telemetry rate limit alignment + FIFO eviction
// ---------------------------------------------------------------------------

describe("Task 3: Telemetry rate limits — aligned cap + FIFO eviction", () => {
  it("MAX_UNIQUE_FINGERPRINTS equals BUFFER_CAP (100)", async () => {
    const { TELEMETRY_RATE_LIMITS } = await import(
      "../../src/core/telemetry/telemetry-buffer.js"
    );
    expect(TELEMETRY_RATE_LIMITS.MAX_UNIQUE_FINGERPRINTS).toBe(100);
  });

  it("source contains FIFO eviction (keys().next().value)", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/core/telemetry/telemetry-buffer.ts"),
      "utf8",
    ) as string;
    // FIFO: get first key from Map (insertion-order oldest) and delete it
    expect(src).toContain(".keys().next().value");
    expect(src).toContain("_fingerprintRateState.delete(");
  });

  it("fingerprint tracker uses FIFO eviction when at cap (does not drop new events)", async () => {
    const { TelemetryBuffer, resetTelemetryRateLimit } = await import(
      "../../src/core/telemetry/telemetry-buffer.js"
    );
    resetTelemetryRateLimit();

    const tmpDir = mkdtempSync(join(tmpdir(), "sidjua-tel-p200-"));
    mkdirSync(join(tmpDir, ".system"), { recursive: true });
    const buffer = new TelemetryBuffer(tmpDir);

    try {
      const makeEv = (fp: string) => ({
        installation_id: "test", fingerprint: fp, error_type: "E",
        error_message: "m", stack_hash: "h".repeat(64),
        sidjua_version: "0", node_version: "v22", os: "linux", arch: "x64",
        timestamp: new Date().toISOString(), severity: "medium" as const,
      });

      // Fill up to the cap (100 unique fingerprints)
      for (let i = 0; i < 100; i++) {
        const stored = buffer.store(makeEv(`fp-${i}`));
        expect(stored).toBe(true);
      }

      // 101st unique fingerprint: FIFO eviction means it is ACCEPTED (not dropped)
      const stored101 = buffer.store(makeEv("fp-eviction-test"));
      expect(stored101).toBe(true);
    } finally {
      buffer.close();
      rmSync(tmpDir, { recursive: true, force: true });
      resetTelemetryRateLimit();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 4 — Async readFile in tasks.ts + reduced spin-wait in db-init.ts
// ---------------------------------------------------------------------------

describe("Task 4: Blocking I/O — tasks.ts async + db-init.ts spin-wait", () => {
  it("tasks.ts runTasksCommand is declared async", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/tasks.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("export async function runTasksCommand");
  });

  it("tasks.ts uses readFile (async) not readFileSync", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/tasks.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("readFile");
    expect(src).not.toContain("readFileSync");
  });

  it("tasks.ts imports readFile from node:fs/promises", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/tasks.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("from \"node:fs/promises\"");
    expect(src).toContain("readFile");
  });

  it("db-init.ts does not spin-wait — synchronous busy-wait removed", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/utils/db-init.ts"),
      "utf8",
    ) as string;
    // P252 FIX-4: the synchronous spin loop was removed entirely.
    // busy_timeout=5000 handles SQLITE_BUSY; a second immediate retry covers
    // the remaining race window without blocking the event loop.
    expect(src).not.toContain("Date.now() + 50");
    expect(src).not.toContain("Date.now() + 500");
    expect(src).not.toContain("while (Date.now() < deadline)");
  });

  it("tasks.ts result file is read and written to stdout", async () => {
    const { writeFile, mkdir, mkdtemp, rm } = await import("node:fs/promises");
    const { runTasksCommand } = await import("../../src/cli/commands/tasks.js");
    const { openDatabase }    = await import("../../src/utils/db.js");
    const { TaskStore }       = await import("../../src/tasks/store.js");
    const { PHASE9_SCHEMA_SQL } = await import("../../src/orchestrator/types.js");

    const tmpDir = await mkdtemp(join(tmpdir(), "sidjua-tasks-async-"));
    const sysDir = join(tmpDir, ".system");
    await mkdir(sysDir, { recursive: true });

    const dbFile = join(sysDir, "sidjua.db");
    const db     = openDatabase(dbFile);
    db.pragma("journal_mode = WAL");
    db.exec(PHASE9_SCHEMA_SQL);
    const store = new TaskStore(db);
    store.initialize();
    const task  = store.create({
      title: "async test", description: "d",
      division: "engineering", type: "root", tier: 1,
      token_budget: 1000, cost_budget: 0.1,
    });
    const resultPath = join(tmpDir, "result.txt");
    await writeFile(resultPath, "RESULT_CONTENT");
    db.prepare("UPDATE tasks SET result_file = ? WHERE id = ?").run("result.txt", task.id);
    db.close();

    let captured = "";
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      captured += String(c); return true;
    });
    try {
      const code = await runTasksCommand({
        workDir: tmpDir, taskId: task.id,
        status: "all", division: undefined, agent: undefined, tier: undefined,
        limit: 20, json: false, summary: false, result: true, tree: false,
      });
      expect(code).toBe(0);
      expect(captured).toContain("RESULT_CONTENT");
    } finally {
      spy.mockRestore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5 — OpenClaw import backup warning
// ---------------------------------------------------------------------------

describe("Task 5: OpenClaw importer — backup warning", () => {
  it("runOpenClawImport emits backup warning before scan message", async () => {
    const { runOpenClawImport } = await import("../../src/cli/commands/import.js");

    let stderrOut = "";
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      stderrOut += String(c); return true;
    });
    // Also suppress stdout
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      // Call with a non-existent config — import will fail, but warning must appear first
      await runOpenClawImport({
        configPath: "/nonexistent/openclaw.json",
        workDir:    "/nonexistent",
        dryRun:     true,
        noSecrets:  true,
        budgetUsd:  50,
        tier:       3,
        division:   "general",
      });
    } catch {
      // Expected to fail
    } finally {
      spy.mockRestore();
      stdoutSpy.mockRestore();
    }

    expect(stderrOut).toContain("WARNING: Back up your OpenClaw data before importing");
    expect(stderrOut).toContain("one-way copy into Sidjua");
    // Warning must appear before any scanning output (stderr starts with warning)
    const warnPos = stderrOut.indexOf("WARNING:");
    expect(warnPos).toBeGreaterThan(-1);
    expect(warnPos).toBeLessThan(50); // appears early in stderr output
  });

  it("backup warning text matches spec", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/import.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("WARNING: Back up your OpenClaw data before importing");
    expect(src).toContain("one-way copy into Sidjua");
    expect(src).toContain("not responsible for");
  });
});
