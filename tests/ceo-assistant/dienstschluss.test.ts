// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for Dienstschluss (session wrap-up) — CEO Assistant
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  generateDienstschlussSummary,
  persistDienstschlussCheckpoint,
  formatDienstschlussOutput,
} from "../../src/ceo-assistant/dienstschluss.js";
import { runCeoAssistantMigrations } from "../../src/ceo-assistant/migration.js";
import { runSessionMigrations }      from "../../src/session/migration.js";
import { runMigrations105 }          from "../../src/agent-lifecycle/migration.js";
import { AssistantTaskQueue }        from "../../src/ceo-assistant/task-queue.js";
import type { BriefingMessage }      from "../../src/session/memory-briefing.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  runMigrations105(db);
  runSessionMigrations(db);
  runCeoAssistantMigrations(db);
  return db;
}

const AGENT = "ceo-assistant";

let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  db = makeDb();
});

// ---------------------------------------------------------------------------
// generateDienstschlussSummary
// ---------------------------------------------------------------------------

describe("generateDienstschlussSummary", () => {
  it("returns a summary with zero tasks when no tasks exist", () => {
    const messages: BriefingMessage[] = [];
    const summary = generateDienstschlussSummary(messages, db, AGENT);
    expect(summary.tasks_created).toBe(0);
    expect(summary.tasks_completed).toBe(0);
    expect(summary.open_tasks_snapshot).toHaveLength(0);
  });

  it("includes open tasks in snapshot", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: AGENT, title: "Review contracts" });
    q.addTask({ agent_id: AGENT, title: "Prep slides" });
    const summary = generateDienstschlussSummary([], db, AGENT);
    expect(summary.open_tasks_snapshot).toHaveLength(2);
  });

  it("counts tasks created from assistant messages", () => {
    const messages: BriefingMessage[] = [
      { role: "assistant", content: "Task added: review vendor list." },
      { role: "assistant", content: "Added task: send Q2 report." },
    ];
    const summary = generateDienstschlussSummary(messages, db, AGENT);
    expect(summary.tasks_created).toBeGreaterThanOrEqual(2);
  });

  it("counts tasks completed from assistant messages", () => {
    const messages: BriefingMessage[] = [
      { role: "assistant", content: "Marked as done: Docker rebuild." },
      { role: "assistant", content: "Task done: audit review." },
    ];
    const summary = generateDienstschlussSummary(messages, db, AGENT);
    expect(summary.tasks_completed).toBeGreaterThanOrEqual(2);
  });

  it("uses short session summary when no assistant messages", () => {
    const summary = generateDienstschlussSummary([], db, AGENT);
    expect(summary.session_summary).toContain("Short session");
  });

  it("sign_off says Goodbye", () => {
    const summary = generateDienstschlussSummary([], db, AGENT);
    expect(summary.sign_off).toContain("Goodbye");
  });

  it("sign_off mentions overdue items when present", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: AGENT, title: "Past due task", deadline: "2020-01-01" });
    const summary = generateDienstschlussSummary([], db, AGENT);
    expect(summary.sign_off).toContain("overdue");
  });

  it("sign_off mentions top priority task when open tasks exist", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: AGENT, title: "Critical task", priority: "P1" });
    const summary = generateDienstschlussSummary([], db, AGENT);
    expect(summary.sign_off).toContain("Critical task");
  });
});

// ---------------------------------------------------------------------------
// persistDienstschlussCheckpoint
// ---------------------------------------------------------------------------

describe("persistDienstschlussCheckpoint", () => {
  it("returns a UUID string", () => {
    const summary = generateDienstschlussSummary([], db, AGENT);
    const id = persistDienstschlussCheckpoint(db, AGENT, "task-123", summary, 5);
    expect(typeof id).toBe("string");
    expect(id).toHaveLength(36); // UUID format
  });

  it("inserts into session_checkpoints", () => {
    const summary = generateDienstschlussSummary([], db, AGENT);
    const id = persistDienstschlussCheckpoint(db, AGENT, "task-123", summary, 5);
    const row = db.prepare<[string], { id: string }>(
      "SELECT id FROM session_checkpoints WHERE id = ?",
    ).get(id);
    expect(row?.id).toBe(id);
  });

  it("does not throw when session_checkpoints table is missing", () => {
    // Only run ceo-assistant migrations (no session migrations — no session_checkpoints table)
    const freshDb = new Database(":memory:");
    runMigrations105(freshDb);
    runCeoAssistantMigrations(freshDb);
    const summary = generateDienstschlussSummary([], freshDb, AGENT);
    expect(() =>
      persistDienstschlussCheckpoint(freshDb, AGENT, "task-x", summary, 1),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// formatDienstschlussOutput
// ---------------------------------------------------------------------------

describe("formatDienstschlussOutput", () => {
  it("contains the Dienstschluss header", () => {
    const summary = generateDienstschlussSummary([], db, AGENT);
    const output = formatDienstschlussOutput(summary);
    expect(output).toContain("Dienstschluss");
  });

  it("lists open tasks by id when present", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: AGENT, title: "Write report" });
    const summary = generateDienstschlussSummary([], db, AGENT);
    const output = formatDienstschlussOutput(summary);
    expect(output).toContain("Write report");
  });

  it("shows task count in open tasks section", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: AGENT, title: "Task A" });
    q.addTask({ agent_id: AGENT, title: "Task B" });
    const summary = generateDienstschlussSummary([], db, AGENT);
    const output = formatDienstschlussOutput(summary);
    expect(output).toContain("Open tasks (2)");
  });

  it("shows tasks this session line when activity occurred", () => {
    const messages: BriefingMessage[] = [
      { role: "assistant", content: "Task added: send Q2 report." },
    ];
    const summary = generateDienstschlussSummary(messages, db, AGENT);
    const output = formatDienstschlussOutput(summary);
    expect(output).toContain("Tasks this session");
  });

  it("ends with sign-off message", () => {
    const summary = generateDienstschlussSummary([], db, AGENT);
    const output = formatDienstschlussOutput(summary);
    expect(output).toContain("Goodbye");
  });

  it("limits open tasks display to 10", () => {
    const q = new AssistantTaskQueue(db);
    for (let i = 0; i < 15; i++) {
      q.addTask({ agent_id: AGENT, title: `Task ${i + 1}` });
    }
    const summary = generateDienstschlussSummary([], db, AGENT);
    const output = formatDienstschlussOutput(summary);
    expect(output).toContain("and 5 more");
  });
});
