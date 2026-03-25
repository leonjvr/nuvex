/**
 * Phase 14: CLI output & summary command tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Command } from "commander";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerOutputCommands } from "../../../src/cli/commands/output.js";
import { openDatabase }           from "../../../src/utils/db.js";
import { TaskOutputStore }        from "../../../src/tasks/output-store.js";
import { TaskSummaryStore }       from "../../../src/tasks/summary-store.js";
import { TaskOutputEmbedder }     from "../../../src/tasks/output-embedder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureOutput(): { getStdout: () => string; getStderr: () => string; restore: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c: unknown) => { out.push(String(c)); return true; };
  process.stderr.write = (c: unknown) => { err.push(String(c)); return true; };
  return {
    getStdout: () => out.join(""),
    getStderr: () => err.join(""),
    restore:   () => { process.stdout.write = origOut; process.stderr.write = origErr; },
  };
}

let workDir: string;
let program: Command;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "sidjua-output-cli-test-"));
  mkdirSync(join(workDir, ".system"), { recursive: true });

  // Pre-create tables in the DB
  const db = openDatabase(join(workDir, ".system", "sidjua.db"));
  db.pragma("journal_mode = WAL");
  const os  = new TaskOutputStore(db);
  const ss  = new TaskSummaryStore(db);
  const emb = new TaskOutputEmbedder(db, null);
  os.initialize(); ss.initialize(); emb.initialize();
  db.close();

  program = new Command();
  program.exitOverride();
  registerOutputCommands(program);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// sidjua output list <task-id>
// ---------------------------------------------------------------------------

describe("sidjua output list", () => {
  it("shows 'No outputs found' when empty", async () => {
    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["output", "list", "nonexistent-task", "--work-dir", workDir],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    expect(cap.getStdout()).toContain("No outputs found");
  });

  it("shows table when outputs exist", async () => {
    // Seed an output
    const db = openDatabase(join(workDir, ".system", "sidjua.db"));
    db.pragma("journal_mode = WAL");
    const store = new TaskOutputStore(db);
    store.initialize();
    store.create({ task_id: "task-abc", agent_id: "agent-1", output_type: "report", content_text: "hello" });
    db.close();

    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["output", "list", "task-abc", "--work-dir", workDir],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    const out = cap.getStdout();
    expect(out).toContain("task-abc");
    expect(out).toContain("report");
    expect(out).toContain("1 output");
  });
});

// ---------------------------------------------------------------------------
// sidjua output search <query>
// ---------------------------------------------------------------------------

describe("sidjua output search", () => {
  it("shows 'No results' when no match", async () => {
    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["output", "search", "unmatched query xyz", "--work-dir", workDir],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    expect(cap.getStdout()).toContain("No results");
  });
});

// ---------------------------------------------------------------------------
// sidjua summary show <task-id>
// ---------------------------------------------------------------------------

describe("sidjua summary show", () => {
  it("displays latest summary for a task", async () => {
    // Seed a summary
    const db = openDatabase(join(workDir, ".system", "sidjua.db"));
    db.pragma("journal_mode = WAL");
    const store = new TaskSummaryStore(db);
    store.initialize();
    store.create({
      task_id:      "task-sum",
      agent_id:     "agent-x",
      summary_text: "All done successfully.",
      key_facts:    ["Key insight A"],
      status:       "completed",
    });
    db.close();

    const cap = captureOutput();
    try {
      await program.parseAsync(
        ["summary", "show", "task-sum", "--work-dir", workDir],
        { from: "user" },
      );
    } finally {
      cap.restore();
    }
    const out = cap.getStdout();
    expect(out).toContain("task-sum");
    expect(out).toContain("completed");
    expect(out).toContain("Key insight A");
  });
});
