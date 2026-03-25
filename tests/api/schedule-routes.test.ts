// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/api/routes/schedule.ts
 *
 * Covers:
 * - GET /api/v1/schedules returns 503 when not configured
 * - GET /api/v1/schedules returns list
 * - GET /api/v1/schedules?agent_id=x filters by agent
 * - GET /api/v1/schedules?division=x filters by division
 * - GET /api/v1/schedules/:id returns single schedule
 * - GET /api/v1/schedules/:id returns 404 for unknown
 * - POST /api/v1/schedules creates with valid body
 * - POST /api/v1/schedules rejects invalid cron
 * - POST /api/v1/schedules rejects missing required fields
 * - PATCH /api/v1/schedules/:id updates
 * - PATCH /api/v1/schedules/:id returns 404 for unknown
 * - DELETE /api/v1/schedules/:id deletes
 * - DELETE /api/v1/schedules/:id returns 404 for unknown
 * - POST /api/v1/schedules/:id/enable enables
 * - POST /api/v1/schedules/:id/disable disables
 * - GET /api/v1/schedules/:id/history returns task history
 * - GET /api/v1/schedules/:id/history returns 503 when taskStore null
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { registerScheduleRoutes } from "../../src/api/routes/schedule.js";
import type { CronSchedulerLike, TaskStoreLike } from "../../src/api/routes/schedule.js";
import type { ScheduleDefinition } from "../../src/scheduler/types.js";
import type { Task } from "../../src/tasks/types.js";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeSchedule(id: string, agentId = "agent-1", division = "eng"): ScheduleDefinition {
  return {
    id,
    agent_id:        agentId,
    division,
    cron_expression: "*/10 * * * *",
    task_template:   { description: "Test task", priority: 5 },
    enabled:         true,
    governance:      { max_cost_per_run: 1.0, max_runs_per_day: 24, require_approval: false },
    last_run_at:     null,
    next_run_at:     new Date(Date.now() + 600_000).toISOString(),
    total_runs:      0,
    total_cost_usd:  0.0,
  };
}

function makeTask(scheduleId: string): Task {
  return {
    id: "task-1", parent_id: null, root_id: "task-1", division: "eng",
    type: "root", tier: 2, title: "[recurring] test", description: "test",
    assigned_agent: "agent-1", status: "DONE", priority: 5, classification: "internal",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    started_at: null, completed_at: null, result_file: null, result_summary: null,
    confidence: null, token_budget: 1000, token_used: 0, cost_budget: 1.0, cost_used: 0.1,
    ttl_seconds: 600, retry_count: 0, max_retries: 3, checkpoint: null,
    sub_tasks_expected: 0, sub_tasks_received: 0, embedding_id: null, metadata: {},
    recurring_schedule_id: scheduleId, is_recurring: true,
  };
}

function makeMockScheduler(schedules: ScheduleDefinition[]): CronSchedulerLike {
  return {
    listSchedules: vi.fn((agentId?: string) =>
      agentId !== undefined ? schedules.filter((s) => s.agent_id === agentId) : schedules,
    ),
    getSchedule: vi.fn((id: string) => schedules.find((s) => s.id === id) ?? null),
    createSchedule: vi.fn(() => makeSchedule("new-sched")),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    enableSchedule: vi.fn(),
    disableSchedule: vi.fn(),
  };
}

function makeMockTaskStore(tasks: Task[]): TaskStoreLike {
  return {
    getByScheduleId: vi.fn((_id: string) => tasks),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: Hono;
let scheduler: ReturnType<typeof makeMockScheduler>;
let taskStore: ReturnType<typeof makeMockTaskStore>;
const schedules: ScheduleDefinition[] = [];

beforeEach(() => {
  schedules.length = 0;
  schedules.push(makeSchedule("sched-1", "agent-1", "eng"));
  schedules.push(makeSchedule("sched-2", "agent-2", "ops"));
  scheduler = makeMockScheduler(schedules);
  taskStore = makeMockTaskStore([makeTask("sched-1")]);
  app = new Hono();
  app.use("*", withAdminCtx);
  registerScheduleRoutes(app, { scheduler, taskStore });
});

// ---------------------------------------------------------------------------
// GET /api/v1/schedules
// ---------------------------------------------------------------------------

describe("GET /api/v1/schedules", () => {
  it("returns 503 when scheduler not configured", async () => {
    const bare = new Hono();
    bare.use("*", withAdminCtx);
    registerScheduleRoutes(bare, {});
    const res = await bare.request("/api/v1/schedules");
    expect(res.status).toBe(503);
  });

  it("returns all schedules", async () => {
    const res  = await app.request("/api/v1/schedules");
    const body = await res.json() as { schedules: ScheduleDefinition[] };
    expect(res.status).toBe(200);
    expect(body.schedules).toHaveLength(2);
  });

  it("filters by agent_id query param", async () => {
    const res  = await app.request("/api/v1/schedules?agent_id=agent-1");
    const body = await res.json() as { schedules: ScheduleDefinition[] };
    expect(res.status).toBe(200);
    expect(body.schedules).toHaveLength(1);
    expect(body.schedules[0].agent_id).toBe("agent-1");
  });

  it("filters by division query param", async () => {
    const res  = await app.request("/api/v1/schedules?division=ops");
    const body = await res.json() as { schedules: ScheduleDefinition[] };
    expect(res.status).toBe(200);
    expect(body.schedules).toHaveLength(1);
    expect(body.schedules[0].division).toBe("ops");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/schedules/:id
// ---------------------------------------------------------------------------

describe("GET /api/v1/schedules/:id", () => {
  it("returns single schedule", async () => {
    const res  = await app.request("/api/v1/schedules/sched-1");
    const body = await res.json() as { schedule: ScheduleDefinition };
    expect(res.status).toBe(200);
    expect(body.schedule.id).toBe("sched-1");
  });

  it("returns 404 for unknown id", async () => {
    const res  = await app.request("/api/v1/schedules/ghost");
    const body = await res.json() as { error: { code: string } };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("SCH-404");
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/schedules
// ---------------------------------------------------------------------------

describe("POST /api/v1/schedules", () => {
  it("creates schedule with valid body", async () => {
    const res = await app.request("/api/v1/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent-1",
        division: "eng",
        cron_expression: "*/10 * * * *",
        task_template: { description: "Heartbeat", priority: 5 },
      }),
    });
    const body = await res.json() as { schedule: ScheduleDefinition };
    expect(res.status).toBe(201);
    expect(body.schedule).toBeDefined();
    expect(scheduler.createSchedule).toHaveBeenCalledOnce();
  });

  it("returns 400 when agent_id is missing", async () => {
    const res = await app.request("/api/v1/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        division: "eng", cron_expression: "*/10 * * * *",
        task_template: { description: "HB" },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when task_template.description is missing", async () => {
    const res = await app.request("/api/v1/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent-1", division: "eng",
        cron_expression: "*/10 * * * *",
        task_template: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 when cron expression is invalid (from scheduler)", async () => {
    const errScheduler = {
      ...scheduler,
      createSchedule: vi.fn(() => { throw new Error("Invalid cron expression"); }),
    };
    const errApp = new Hono();
    errApp.use("*", withAdminCtx);
    registerScheduleRoutes(errApp, { scheduler: errScheduler, taskStore });

    const res = await errApp.request("/api/v1/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "agent-1", division: "eng",
        cron_expression: "bad-cron",
        task_template: { description: "HB" },
      }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/v1/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json {{{",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/schedules/:id
// ---------------------------------------------------------------------------

describe("PATCH /api/v1/schedules/:id", () => {
  it("updates schedule", async () => {
    const res = await app.request("/api/v1/schedules/sched-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(scheduler.updateSchedule).toHaveBeenCalledWith("sched-1", { enabled: false });
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/api/v1/schedules/ghost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/schedules/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/schedules/:id", () => {
  it("deletes schedule", async () => {
    const res  = await app.request("/api/v1/schedules/sched-1", { method: "DELETE" });
    const body = await res.json() as { deleted: boolean };
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(scheduler.deleteSchedule).toHaveBeenCalledWith("sched-1");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/api/v1/schedules/ghost", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/schedules/:id/enable & /disable
// ---------------------------------------------------------------------------

describe("POST enable/disable", () => {
  it("enables a schedule", async () => {
    const res  = await app.request("/api/v1/schedules/sched-1/enable", { method: "POST" });
    const body = await res.json() as { enabled: boolean };
    expect(res.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(scheduler.enableSchedule).toHaveBeenCalledWith("sched-1");
  });

  it("disables a schedule", async () => {
    const res  = await app.request("/api/v1/schedules/sched-1/disable", { method: "POST" });
    const body = await res.json() as { enabled: boolean };
    expect(res.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(scheduler.disableSchedule).toHaveBeenCalledWith("sched-1");
  });

  it("enable returns 404 when schedule throws not found", async () => {
    (scheduler.enableSchedule as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Schedule 'ghost' not found");
    });
    const res = await app.request("/api/v1/schedules/ghost/enable", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/schedules/:id/history
// ---------------------------------------------------------------------------

describe("GET /api/v1/schedules/:id/history", () => {
  it("returns 503 when taskStore not configured", async () => {
    const bare = new Hono();
    bare.use("*", withAdminCtx);
    registerScheduleRoutes(bare, { scheduler });
    const res = await bare.request("/api/v1/schedules/sched-1/history");
    expect(res.status).toBe(503);
  });

  it("returns task execution history", async () => {
    const res  = await app.request("/api/v1/schedules/sched-1/history");
    const body = await res.json() as { tasks: Task[]; schedule_id: string };
    expect(res.status).toBe(200);
    expect(body.schedule_id).toBe("sched-1");
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].recurring_schedule_id).toBe("sched-1");
  });

  it("respects limit query param", async () => {
    const res = await app.request("/api/v1/schedules/sched-1/history?limit=5");
    expect(res.status).toBe(200);
    expect(taskStore.getByScheduleId).toHaveBeenCalledWith("sched-1");
  });
});
