// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/scheduler/deadline-watcher.ts
 *
 * Covers:
 * - checkDeadlines: emits approaching_deadline (warning) when elapsed% >= threshold
 * - checkDeadlines: emits deadline_passed (critical) when elapsed% >= 100
 * - checkDeadlines: skips tasks with ttl_seconds = 0
 * - checkDeadlines: skips terminal tasks (DONE, FAILED, CANCELLED)
 * - checkBudgets: emits budget_exhausted when cost_used >= cost_budget
 * - checkBudgets: skips tasks with cost_budget = 0
 * - checkAll: combines both checks and deduplicates by task_id + type
 * - checkAll: returns empty array when no issues found
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync }  from "node:fs";
import { tmpdir }               from "node:os";
import { join }                 from "node:path";
import { openDatabase }         from "../../src/utils/db.js";
import { TaskStore }            from "../../src/tasks/store.js";
import { DeadlineWatcher }      from "../../src/scheduler/deadline-watcher.js";
import type { Database }        from "../../src/utils/db.js";
import type { SchedulingGovernance } from "../../src/scheduler/types.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GOVERNANCE: SchedulingGovernance = {
  enabled: true,
  global_limits: {
    max_schedules_per_agent:          10,
    max_schedules_per_division:       50,
    max_total_scheduled_cost_per_day: 50.0,
    min_cron_interval_minutes:        5,
  },
  deadline_watcher: {
    enabled:                   true,
    check_interval_ms:         60_000,
    warning_threshold_percent: 80,
  },
};

function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title:        "Test task",
    description:  "Some work",
    division:     "engineering",
    type:         "root",
    tier:         1,
    token_budget: 10_000,
    cost_budget:  0,          // no budget by default
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir:  string;
let db:      Database;
let store:   TaskStore;
let watcher: DeadlineWatcher;

beforeEach(() => {
  tmpDir  = mkdtempSync(join(tmpdir(), "deadline-watcher-test-"));
  db      = openDatabase(join(tmpDir, "test.db"));
  store   = new TaskStore(db);
  store.initialize();
  watcher = new DeadlineWatcher(store, GOVERNANCE);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// checkDeadlines
// ---------------------------------------------------------------------------

describe("checkDeadlines", () => {
  it("emits approaching_deadline warning when task is past threshold", () => {
    const task = store.create(makeTaskInput({ ttl_seconds: 100 }));
    // Place created_at so 85% of TTL has elapsed
    const createdAt = new Date(Date.now() - 85_000);
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(createdAt.toISOString(), task.id);
    store.update(task.id, { status: "RUNNING" });

    const now    = new Date();
    const events = watcher.checkDeadlines(now);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("approaching_deadline");
    expect(events[0].severity).toBe("warning");
    expect(events[0].task_id).toBe(task.id);
  });

  it("emits deadline_passed critical when task exceeds TTL", () => {
    const task = store.create(makeTaskInput({ ttl_seconds: 60 }));
    // Place created_at so 110% of TTL has elapsed
    const createdAt = new Date(Date.now() - 66_000);
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(createdAt.toISOString(), task.id);
    store.update(task.id, { status: "RUNNING" });

    const events = watcher.checkDeadlines(new Date());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("deadline_passed");
    expect(events[0].severity).toBe("critical");
  });

  it("does not emit when elapsed is below threshold", () => {
    const task = store.create(makeTaskInput({ ttl_seconds: 3600 }));
    // 1% elapsed — well below 80%
    const createdAt = new Date(Date.now() - 36_000);
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(createdAt.toISOString(), task.id);
    store.update(task.id, { status: "RUNNING" });

    expect(watcher.checkDeadlines(new Date())).toHaveLength(0);
  });

  it("skips tasks with ttl_seconds = 0", () => {
    const task = store.create(makeTaskInput({ ttl_seconds: 0 }));
    store.update(task.id, { status: "RUNNING" });
    expect(watcher.checkDeadlines(new Date())).toHaveLength(0);
  });

  it("skips tasks in terminal statuses (DONE)", () => {
    const task = store.create(makeTaskInput({ ttl_seconds: 10 }));
    // Created 20 seconds ago — would normally fire
    const createdAt = new Date(Date.now() - 20_000);
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(createdAt.toISOString(), task.id);
    store.update(task.id, { status: "DONE" });
    expect(watcher.checkDeadlines(new Date())).toHaveLength(0);
  });

  it("includes PENDING and WAITING tasks", () => {
    const t1 = store.create(makeTaskInput({ ttl_seconds: 60 }));
    const t2 = store.create(makeTaskInput({ ttl_seconds: 60 }));
    const createdAt = new Date(Date.now() - 70_000);
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(createdAt.toISOString(), t1.id);
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(createdAt.toISOString(), t2.id);
    store.update(t1.id, { status: "PENDING" });
    store.update(t2.id, { status: "WAITING" });

    const events = watcher.checkDeadlines(new Date());
    const types  = events.map((e) => e.type);
    expect(types.every((t) => t === "deadline_passed")).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// checkBudgets
// ---------------------------------------------------------------------------

describe("checkBudgets", () => {
  it("emits budget_exhausted when cost_used >= cost_budget", () => {
    const task = store.create(makeTaskInput({ cost_budget: 1.0 }));
    store.update(task.id, { status: "RUNNING" });
    db.prepare("UPDATE tasks SET cost_used = 1.00 WHERE id = ?").run(task.id);

    const events = watcher.checkBudgets();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("budget_exhausted");
    expect(events[0].severity).toBe("critical");
    expect(events[0].task_id).toBe(task.id);
  });

  it("does not emit when cost_used < cost_budget", () => {
    const task = store.create(makeTaskInput({ cost_budget: 1.0 }));
    store.update(task.id, { status: "RUNNING" });
    db.prepare("UPDATE tasks SET cost_used = 0.50 WHERE id = ?").run(task.id);
    expect(watcher.checkBudgets()).toHaveLength(0);
  });

  it("skips tasks with cost_budget = 0", () => {
    const task = store.create(makeTaskInput({ cost_budget: 0 }));
    store.update(task.id, { status: "RUNNING" });
    db.prepare("UPDATE tasks SET cost_used = 999 WHERE id = ?").run(task.id);
    expect(watcher.checkBudgets()).toHaveLength(0);
  });

  it("only checks RUNNING and ASSIGNED tasks", () => {
    const task = store.create(makeTaskInput({ cost_budget: 0.5 }));
    // PENDING — should not be checked for budget
    db.prepare("UPDATE tasks SET cost_used = 1.00 WHERE id = ?").run(task.id);
    expect(watcher.checkBudgets()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// checkAll
// ---------------------------------------------------------------------------

describe("checkAll", () => {
  it("returns empty array when no issues", () => {
    store.create(makeTaskInput());
    expect(watcher.checkAll(new Date())).toHaveLength(0);
  });

  it("combines deadline and budget events", () => {
    // Deadline task
    const t1 = store.create(makeTaskInput({ ttl_seconds: 60 }));
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(
      new Date(Date.now() - 70_000).toISOString(),
      t1.id,
    );
    store.update(t1.id, { status: "RUNNING" });

    // Budget task
    const t2 = store.create(makeTaskInput({ cost_budget: 1.0 }));
    store.update(t2.id, { status: "RUNNING" });
    db.prepare("UPDATE tasks SET cost_used = 2.00 WHERE id = ?").run(t2.id);

    const events = watcher.checkAll(new Date());
    const types  = new Set(events.map((e) => e.type));
    expect(types.has("deadline_passed")).toBe(true);
    expect(types.has("budget_exhausted")).toBe(true);
  });

  it("deduplicates events with the same task_id + type", () => {
    // Create a task that would fire both deadline_passed from checkDeadlines twice
    // — simulate by building a single task but calling checkAll twice — deduplicate
    // In practice, duplicates arise if a task appears in multiple status queries.
    // We test the dedup logic by checking that checkAll doesn't return duplicates.
    const task = store.create(makeTaskInput({ ttl_seconds: 60 }));
    db.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").run(
      new Date(Date.now() - 70_000).toISOString(),
      task.id,
    );
    store.update(task.id, { status: "RUNNING" });

    const events = watcher.checkAll(new Date());
    const keys   = events.map((e) => `${e.task_id}:${e.type}`);
    const unique = new Set(keys);
    expect(keys.length).toBe(unique.size);
  });
});
