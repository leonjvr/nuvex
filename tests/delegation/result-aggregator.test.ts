// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * ResultAggregator — unit tests
 *
 * Test cases:
 *   1. RESULT_READY for delegation subtask calls delegationService.markCompleted
 *   2. TASK_FAILED for delegation subtask calls delegationService.markFailed
 *   3. Non-delegation task (no parent_id) is silently ignored
 *   4. All subtasks complete → sendTaskCompleted called for messaging task
 *   5. RESULT_READY for non-delegation type is ignored
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResultAggregator } from "../../src/delegation/result-aggregator.js";
import type { EventBusLike, TaskStoreLike } from "../../src/delegation/result-aggregator.js";
import type { DelegationService } from "../../src/delegation/delegation-service.js";
import type { ResponseRouter } from "../../src/messaging/response-router.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Handler = (data: unknown) => void;

function makeEventBus(): EventBusLike & { trigger: (event: string, data: unknown) => void } {
  const handlers = new Map<string, Handler[]>();
  return {
    on: (event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    trigger: (event: string, data: unknown) => {
      for (const h of handlers.get(event) ?? []) h(data);
    },
  };
}

function makeDelegationTask(id: string, parentId: string | null, type = "delegation") {
  return {
    id,
    type,
    parent_id:          parentId,
    root_id:            parentId ?? id,
    status:             "DONE",
    title:              "test",
    description:        "test task",
    division:           "engineering",
    tier:               2,
    priority:           2,
    classification:     "INTERNAL",
    token_budget:       10000,
    cost_budget:        1.0,
    cost_used:          0.05,
    ttl_seconds:        null,
    assigned_agent:     "agent-t2",
    metadata:           {},
    result_summary:     "Worker done",
    retry_count:        0,
    max_retries:        0,
    checkpoint:         null,
    sub_tasks_expected: 0,
    sub_tasks_received: 0,
    source_metadata:    undefined,
    governance_override: undefined,
    created_at:         new Date().toISOString(),
    updated_at:         new Date().toISOString(),
    completed_at:       new Date().toISOString(),
  };
}

function makeParentTask(id: string, subTasksExpected: number, sourceMetadata?: unknown) {
  return {
    ...makeDelegationTask(id, null, "root"),
    sub_tasks_expected: subTasksExpected,
    source_metadata:    sourceMetadata,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResultAggregator — RESULT_READY handling", () => {
  it("calls delegationService.markCompleted when delegation subtask completes", async () => {
    const eventBus = makeEventBus();
    const subtask  = makeDelegationTask("sub-1", "parent-1");

    const taskStore: TaskStoreLike = {
      get:          vi.fn((id) => id === "sub-1" ? subtask : null),
      update:       vi.fn().mockReturnValue({ id: "parent-1" }),
      getByParent:  vi.fn().mockReturnValue([]),
    };
    const delegSvc = { markCompleted: vi.fn(), markFailed: vi.fn() } as unknown as DelegationService;
    const router   = { sendTaskCompleted: vi.fn(), sendTaskFailed: vi.fn() } as unknown as ResponseRouter;

    const agg = new ResultAggregator(eventBus, taskStore, delegSvc, router);
    agg.start();

    eventBus.trigger("RESULT_READY", { task_id: "sub-1" });
    await new Promise((r) => setTimeout(r, 10));

    expect(delegSvc.markCompleted).toHaveBeenCalledWith("sub-1", "Worker done", 0.05);
  });

  it("calls delegationService.markFailed when delegation subtask fails", async () => {
    const eventBus = makeEventBus();
    const subtask  = { ...makeDelegationTask("sub-2", "parent-1"), status: "FAILED" };

    const taskStore: TaskStoreLike = {
      get:         vi.fn((id) => id === "sub-2" ? subtask : null),
      update:      vi.fn().mockReturnValue({ id: "parent-1" }),
      getByParent: vi.fn().mockReturnValue([]),
    };
    const delegSvc = { markCompleted: vi.fn(), markFailed: vi.fn() } as unknown as DelegationService;
    const router   = { sendTaskCompleted: vi.fn(), sendTaskFailed: vi.fn() } as unknown as ResponseRouter;

    const agg = new ResultAggregator(eventBus, taskStore, delegSvc, router);
    agg.start();

    eventBus.trigger("TASK_FAILED", { task_id: "sub-2", data: { error: "boom" } });
    await new Promise((r) => setTimeout(r, 10));

    expect(delegSvc.markFailed).toHaveBeenCalledWith("sub-2", "boom");
  });

  it("ignores non-delegation tasks (no parent_id set)", async () => {
    const eventBus = makeEventBus();
    const rootTask = makeDelegationTask("root-1", null, "root");

    const taskStore: TaskStoreLike = {
      get:         vi.fn().mockReturnValue(rootTask),
      update:      vi.fn(),
      getByParent: vi.fn().mockReturnValue([]),
    };
    const delegSvc = { markCompleted: vi.fn(), markFailed: vi.fn() } as unknown as DelegationService;
    const router   = { sendTaskCompleted: vi.fn(), sendTaskFailed: vi.fn() } as unknown as ResponseRouter;

    const agg = new ResultAggregator(eventBus, taskStore, delegSvc, router);
    agg.start();

    eventBus.trigger("RESULT_READY", { task_id: "root-1" });
    await new Promise((r) => setTimeout(r, 10));

    expect(delegSvc.markCompleted).not.toHaveBeenCalled();
    expect(router.sendTaskCompleted).not.toHaveBeenCalled();
  });

  it("routes aggregated result via sendTaskCompleted when all subtasks complete for messaging task", async () => {
    const eventBus = makeEventBus();
    const sub1     = makeDelegationTask("sub-1", "parent-msg");
    const parent   = makeParentTask("parent-msg", 1, {
      source_channel:     "telegram",
      source_instance_id: "inst-1",
      source_message_id:  "msg-42",
      source_chat_id:     "chat-1",
      source_user:        "user-1",
    });

    const taskStore: TaskStoreLike = {
      get: vi.fn((id) => id === "sub-1" ? sub1 : id === "parent-msg" ? parent : null),
      update:      vi.fn().mockReturnValue({ id: "parent-msg" }),
      getByParent: vi.fn().mockReturnValue([sub1]), // 1 subtask done = expected
    };
    const delegSvc  = { markCompleted: vi.fn(), markFailed: vi.fn() } as unknown as DelegationService;
    const completeSpy = vi.fn().mockResolvedValue(undefined);
    const router    = { sendTaskCompleted: completeSpy, sendTaskFailed: vi.fn() } as unknown as ResponseRouter;

    const agg = new ResultAggregator(eventBus, taskStore, delegSvc, router);
    agg.start();

    eventBus.trigger("RESULT_READY", { task_id: "sub-1" });
    await new Promise((r) => setTimeout(r, 20));

    expect(completeSpy).toHaveBeenCalledOnce();
  });

  it("ignores delegation subtask with type != 'delegation'", async () => {
    const eventBus  = makeEventBus();
    const wrongType = { ...makeDelegationTask("sub-x", "parent-1"), type: "consultation" };

    const taskStore: TaskStoreLike = {
      get:         vi.fn().mockReturnValue(wrongType),
      update:      vi.fn(),
      getByParent: vi.fn().mockReturnValue([]),
    };
    const delegSvc = { markCompleted: vi.fn(), markFailed: vi.fn() } as unknown as DelegationService;
    const router   = { sendTaskCompleted: vi.fn(), sendTaskFailed: vi.fn() } as unknown as ResponseRouter;

    const agg = new ResultAggregator(eventBus, taskStore, delegSvc, router);
    agg.start();

    eventBus.trigger("RESULT_READY", { task_id: "sub-x" });
    await new Promise((r) => setTimeout(r, 10));

    expect(delegSvc.markCompleted).not.toHaveBeenCalled();
  });
});
