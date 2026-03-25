// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for AssistantTaskQueue — CEO Assistant
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AssistantTaskQueue } from "../../src/ceo-assistant/task-queue.js";
import { runCeoAssistantMigrations } from "../../src/ceo-assistant/migration.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeQueue() {
  const db = new Database(":memory:");
  runCeoAssistantMigrations(db);
  return new AssistantTaskQueue(db);
}

const AGENT = "ceo-assistant";

let queue: AssistantTaskQueue;

beforeEach(() => {
  queue = makeQueue();
});

// ---------------------------------------------------------------------------
// addTask
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.addTask", () => {
  it("creates a task with default priority P3", () => {
    const task = queue.addTask({ agent_id: AGENT, title: "Review Q1 data" });
    expect(task.id).toBeGreaterThan(0);
    expect(task.priority).toBe("P3");
    expect(task.status).toBe("open");
    expect(task.title).toBe("Review Q1 data");
  });

  it("creates task with explicit priority", () => {
    const task = queue.addTask({ agent_id: AGENT, title: "Critical bug", priority: "P1" });
    expect(task.priority).toBe("P1");
  });

  it("stores deadline when provided", () => {
    const task = queue.addTask({ agent_id: AGENT, title: "Audit", deadline: "2026-12-31" });
    expect(task.deadline).toBe("2026-12-31");
  });

  it("stores context_notes when provided", () => {
    const task = queue.addTask({ agent_id: AGENT, title: "Review", context_notes: "Focus on Q4" });
    expect(task.context_notes).toBe("Focus on Q4");
  });

  it("throws on empty title", () => {
    expect(() => queue.addTask({ agent_id: AGENT, title: "" })).toThrow("empty");
  });

  it("throws on invalid priority", () => {
    expect(() => queue.addTask({ agent_id: AGENT, title: "X", priority: "P9" as "P1" })).toThrow("Invalid priority");
  });

  it("trims whitespace from title", () => {
    const task = queue.addTask({ agent_id: AGENT, title: "  Hello world  " });
    expect(task.title).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.listTasks", () => {
  it("returns empty array when no tasks", () => {
    expect(queue.listTasks(AGENT)).toHaveLength(0);
  });

  it("returns all open tasks for agent", () => {
    queue.addTask({ agent_id: AGENT, title: "Task A" });
    queue.addTask({ agent_id: AGENT, title: "Task B" });
    expect(queue.listTasks(AGENT)).toHaveLength(2);
  });

  it("filters by status", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Task A" });
    queue.completeTask(AGENT, t.id);
    const open = queue.listTasks(AGENT, { status: "open" });
    expect(open).toHaveLength(0);
  });

  it("filters by priority", () => {
    queue.addTask({ agent_id: AGENT, title: "P1 task", priority: "P1" });
    queue.addTask({ agent_id: AGENT, title: "P3 task", priority: "P3" });
    const p1 = queue.listTasks(AGENT, { priority: "P1" });
    expect(p1).toHaveLength(1);
    expect(p1[0]!.title).toBe("P1 task");
  });

  it("returns tasks for correct agent only", () => {
    queue.addTask({ agent_id: AGENT,  title: "Mine" });
    queue.addTask({ agent_id: "other", title: "Theirs" });
    expect(queue.listTasks(AGENT)).toHaveLength(1);
  });

  it("orders by priority ASC (P1 first)", () => {
    queue.addTask({ agent_id: AGENT, title: "Low",  priority: "P4" });
    queue.addTask({ agent_id: AGENT, title: "High", priority: "P1" });
    const tasks = queue.listTasks(AGENT);
    expect(tasks[0]!.priority).toBe("P1");
  });
});

// ---------------------------------------------------------------------------
// completeTask
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.completeTask", () => {
  it("sets status to done and completed_at", () => {
    const t    = queue.addTask({ agent_id: AGENT, title: "Deploy" });
    const done = queue.completeTask(AGENT, t.id);
    expect(done).not.toBeNull();
    expect(done!.status).toBe("done");
    expect(done!.completed_at).toBeDefined();
  });

  it("returns null for unknown task", () => {
    expect(queue.completeTask(AGENT, 9999)).toBeNull();
  });

  it("returns null for already-done task", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Done twice" });
    queue.completeTask(AGENT, t.id);
    expect(queue.completeTask(AGENT, t.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cancelTask
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.cancelTask", () => {
  it("sets status to cancelled", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Experiment" });
    const r = queue.cancelTask(AGENT, t.id);
    expect(r!.status).toBe("cancelled");
  });

  it("returns null for unknown task", () => {
    expect(queue.cancelTask(AGENT, 9999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.updateTask", () => {
  it("updates title", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Old title" });
    const updated = queue.updateTask(AGENT, t.id, { title: "New title" });
    expect(updated!.title).toBe("New title");
  });

  it("updates priority", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Task" });
    const updated = queue.updateTask(AGENT, t.id, { priority: "P1" });
    expect(updated!.priority).toBe("P1");
  });

  it("throws on invalid priority", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Task" });
    expect(() => queue.updateTask(AGENT, t.id, { priority: "X" as "P1" })).toThrow("Invalid priority");
  });

  it("updates deadline", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Task" });
    const updated = queue.updateTask(AGENT, t.id, { deadline: "2027-01-01" });
    expect(updated!.deadline).toBe("2027-01-01");
  });
});

// ---------------------------------------------------------------------------
// getOverdueTasks
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.getOverdueTasks", () => {
  it("returns empty when no overdue tasks", () => {
    queue.addTask({ agent_id: AGENT, title: "Future", deadline: "2999-12-31" });
    expect(queue.getOverdueTasks(AGENT)).toHaveLength(0);
  });

  it("returns tasks with past deadline", () => {
    queue.addTask({ agent_id: AGENT, title: "Overdue", deadline: "2020-01-01" });
    expect(queue.getOverdueTasks(AGENT)).toHaveLength(1);
  });

  it("does not return done tasks as overdue", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Done", deadline: "2020-01-01" });
    queue.completeTask(AGENT, t.id);
    expect(queue.getOverdueTasks(AGENT)).toHaveLength(0);
  });

  it("does not return tasks without deadline as overdue", () => {
    queue.addTask({ agent_id: AGENT, title: "No deadline" });
    expect(queue.getOverdueTasks(AGENT)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findByTitleFuzzy
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.findByTitleFuzzy", () => {
  it("finds a task by partial title match", () => {
    queue.addTask({ agent_id: AGENT, title: "Docker rebuild analysis" });
    const found = queue.findByTitleFuzzy(AGENT, "docker rebuild");
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Docker rebuild analysis");
  });

  it("returns null when no match", () => {
    queue.addTask({ agent_id: AGENT, title: "Something else" });
    expect(queue.findByTitleFuzzy(AGENT, "xyznothing")).toBeNull();
  });

  it("match is case-insensitive", () => {
    queue.addTask({ agent_id: AGENT, title: "Deploy Kubernetes cluster" });
    expect(queue.findByTitleFuzzy(AGENT, "KUBERNETES")).not.toBeNull();
  });

  it("does not match done tasks", () => {
    const t = queue.addTask({ agent_id: AGENT, title: "Completed task" });
    queue.completeTask(AGENT, t.id);
    expect(queue.findByTitleFuzzy(AGENT, "completed task")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe("AssistantTaskQueue.getStats", () => {
  it("returns zero counts for empty queue", () => {
    const stats = queue.getStats(AGENT);
    expect(stats.open).toBe(0);
    expect(stats.overdue).toBe(0);
    expect(stats.done).toBe(0);
  });

  it("counts correctly", () => {
    queue.addTask({ agent_id: AGENT, title: "Open 1" });
    queue.addTask({ agent_id: AGENT, title: "Open 2" });
    const t3 = queue.addTask({ agent_id: AGENT, title: "Overdue", deadline: "2020-01-01" });
    void t3;
    const t4 = queue.addTask({ agent_id: AGENT, title: "Done" });
    queue.completeTask(AGENT, t4.id);
    const stats = queue.getStats(AGENT);
    expect(stats.open).toBe(3);   // 2 regular + 1 overdue (all open status)
    expect(stats.overdue).toBe(1);
    expect(stats.done).toBe(1);
  });
});
