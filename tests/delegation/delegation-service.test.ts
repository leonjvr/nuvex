// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * DelegationService — unit tests
 *
 * Test cases:
 *   1. delegate() creates subtask and returns subtask_id on success
 *   2. delegate() returns error when policy resolver denies
 *   3. delegate() returns error when budget exceeded
 *   4. delegate() returns error when max_subtasks_per_task exceeded
 *   5. markCompleted() transitions status and emits event
 *   6. markFailed() transitions status and emits event
 *   7. checkTimeouts() marks overdue pending delegations as timeout
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DelegationService } from "../../src/delegation/delegation-service.js";
import type { TaskStoreLike, EventBusLike, AgentRegistryLike } from "../../src/delegation/delegation-service.js";
import type { DelegationPolicyResolver } from "../../src/delegation/policy-resolver.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTaskStore(overrides: Partial<TaskStoreLike> = {}): TaskStoreLike {
  return {
    get: vi.fn().mockReturnValue({
      id:                 "parent-1",
      cost_budget:        10.0,
      cost_used:          1.0,
      token_budget:       100000,
      division:           "engineering",
      tier:               1,
      classification:     "INTERNAL",
      sub_tasks_expected: 0,
    }),
    create: vi.fn().mockReturnValue({ id: "subtask-abc" }),
    update: vi.fn().mockReturnValue({ id: "parent-1" }),
    ...overrides,
  };
}

function makeEventBus(): EventBusLike & { events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    events,
    emit: vi.fn((event: string, data: unknown) => { events.push({ event, data }); }),
    on:   vi.fn(),
  };
}

function makePolicyResolver(allowed: boolean, reason?: string): DelegationPolicyResolver {
  return {
    canDelegate:          vi.fn().mockReturnValue({ allowed, reason }),
    resolvePolicy:        vi.fn(),
    listDelegatableAgents: vi.fn().mockReturnValue([]),
  } as unknown as DelegationPolicyResolver;
}

/** Passthrough registry — returns null (unknown agent), so division check passes. */
function makeRegistry(): AgentRegistryLike {
  return { getById: vi.fn().mockReturnValue(null) };
}

const BASE_REQUEST = {
  parent_task_id:  "parent-1",
  source_agent_id: "agent-t1",
  target_agent_id: "agent-t2",
  description:     "Do the thing",
  priority:        2,
  budget_usd:      1.0, // within 50% of remaining (9.0 * 0.5 = 4.5)
  require_result:  false,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DelegationService — delegate()", () => {
  it("creates subtask and returns subtask_id on success", async () => {
    const taskStore = makeTaskStore();
    const eventBus  = makeEventBus();
    const resolver  = makePolicyResolver(true);
    const svc       = new DelegationService(taskStore, eventBus, resolver, makeRegistry());

    const result = await svc.delegate(BASE_REQUEST);

    expect(result.success).toBe(true);
    expect(result.subtask_id).toBe("subtask-abc");
    expect(taskStore.create).toHaveBeenCalledOnce();
    expect(taskStore.update).toHaveBeenCalledWith("parent-1", { sub_tasks_expected: 1 });

    // Should emit delegation_created event
    const createdEvent = eventBus.events.find((e) => e.event === "delegation_created");
    expect(createdEvent).toBeDefined();
  });

  it("returns error when policy resolver denies", async () => {
    const taskStore = makeTaskStore();
    const eventBus  = makeEventBus();
    const resolver  = makePolicyResolver(false, "source_tier_too_low");
    const svc       = new DelegationService(taskStore, eventBus, resolver, makeRegistry());

    const result = await svc.delegate(BASE_REQUEST);

    expect(result.success).toBe(false);
    expect(result.error).toBe("source_tier_too_low");
    expect(taskStore.create).not.toHaveBeenCalled();

    // Should emit delegation_rejected event
    const rejectedEvent = eventBus.events.find((e) => e.event === "delegation_rejected");
    expect(rejectedEvent).toBeDefined();
  });

  it("returns error when requested budget exceeds allowed share", async () => {
    const taskStore = makeTaskStore({
      get: vi.fn().mockReturnValue({
        id: "parent-1", cost_budget: 10.0, cost_used: 9.5,  // only 0.5 remaining
        token_budget: 100000, division: "engineering", tier: 1,
        classification: "INTERNAL", sub_tasks_expected: 0,
      }),
    });
    const resolver = makePolicyResolver(true);
    const svc      = new DelegationService(taskStore, makeEventBus(), resolver, makeRegistry());

    // Requests 1.0 USD but only 0.25 (50% of 0.5) is allowed
    const result = await svc.delegate({ ...BASE_REQUEST, budget_usd: 1.0 });

    expect(result.success).toBe(false);
    expect(result.error).toBe("insufficient_budget");
    expect(taskStore.create).not.toHaveBeenCalled();
  });

  it("returns error when parent task not found", async () => {
    const taskStore = makeTaskStore({ get: vi.fn().mockReturnValue(null) });
    const resolver  = makePolicyResolver(true);
    const svc       = new DelegationService(taskStore, makeEventBus(), resolver, makeRegistry());

    const result = await svc.delegate(BASE_REQUEST);

    expect(result.success).toBe(false);
    expect(result.error).toBe("parent_task_not_found");
  });

  it("returns error when max_subtasks_per_task exceeded", async () => {
    const taskStore = makeTaskStore();
    const resolver  = makePolicyResolver(true);
    const svc       = new DelegationService(taskStore, makeEventBus(), resolver, makeRegistry(), {
      max_subtasks_per_task: 2,
    });

    // Pre-fill 2 active pending delegations for same parent
    const req1 = { ...BASE_REQUEST };
    const req2 = { ...BASE_REQUEST };
    await svc.delegate(req1);
    vi.mocked(taskStore.create).mockReturnValueOnce({ id: "subtask-2" });
    await svc.delegate(req2);

    // 3rd should fail
    vi.mocked(taskStore.create).mockReturnValueOnce({ id: "subtask-3" });
    const result = await svc.delegate(BASE_REQUEST);

    expect(result.success).toBe(false);
    expect(result.error).toBe("max_subtasks_exceeded");
  });
});

describe("DelegationService — markCompleted / markFailed", () => {
  it("markCompleted transitions status and emits delegation_completed", async () => {
    const taskStore = makeTaskStore();
    const eventBus  = makeEventBus();
    const svc       = new DelegationService(taskStore, eventBus, makePolicyResolver(true), makeRegistry());

    await svc.delegate(BASE_REQUEST);
    svc.markCompleted("subtask-abc", "Done successfully", 0.05);

    const d = svc.getStatus("subtask-abc");
    expect(d?.status).toBe("completed");
    expect(d?.result_summary).toBe("Done successfully");
    expect(d?.cost_usd).toBe(0.05);
    expect(d?.completed_at).toBeDefined();

    const completedEvent = eventBus.events.find((e) => e.event === "delegation_completed");
    expect(completedEvent).toBeDefined();
  });

  it("markFailed transitions status and emits delegation_failed", async () => {
    const taskStore = makeTaskStore();
    const eventBus  = makeEventBus();
    const svc       = new DelegationService(taskStore, eventBus, makePolicyResolver(true), makeRegistry());

    await svc.delegate(BASE_REQUEST);
    svc.markFailed("subtask-abc", "something went wrong");

    const d = svc.getStatus("subtask-abc");
    expect(d?.status).toBe("failed");
    expect(d?.result_summary).toBe("something went wrong");

    const failedEvent = eventBus.events.find((e) => e.event === "delegation_failed");
    expect(failedEvent).toBeDefined();
  });
});

describe("DelegationService — checkTimeouts()", () => {
  it("marks overdue pending delegations as timeout", async () => {
    const taskStore = makeTaskStore();
    const eventBus  = makeEventBus();
    const svc       = new DelegationService(taskStore, eventBus, makePolicyResolver(true), makeRegistry(), {
      default_timeout_seconds: 0, // immediately timeout
    });

    await svc.delegate(BASE_REQUEST);

    // Wait at least 1ms so ageMs > limitMs=0
    await new Promise((r) => setTimeout(r, 5));
    const timedOut = svc.checkTimeouts();

    expect(timedOut).toContain("subtask-abc");
    const d = svc.getStatus("subtask-abc");
    expect(d?.status).toBe("timeout");

    const timeoutEvent = eventBus.events.find((e) => e.event === "delegation_timeout");
    expect(timeoutEvent).toBeDefined();
  });

  it("does not mark already-completed delegations as timeout", async () => {
    const taskStore = makeTaskStore();
    const svc       = new DelegationService(taskStore, makeEventBus(), makePolicyResolver(true), makeRegistry(), {
      default_timeout_seconds: 0,
    });

    await svc.delegate(BASE_REQUEST);
    svc.markCompleted("subtask-abc", "Done", 0.01);

    const timedOut = svc.checkTimeouts();
    expect(timedOut).not.toContain("subtask-abc");
  });
});

describe("DelegationService — getAllDelegations()", () => {
  it("returns all delegations regardless of status", async () => {
    const taskStore = makeTaskStore();
    vi.mocked(taskStore.create)
      .mockReturnValueOnce({ id: "sub-1" })
      .mockReturnValueOnce({ id: "sub-2" });

    const svc = new DelegationService(taskStore, makeEventBus(), makePolicyResolver(true), makeRegistry());

    await svc.delegate(BASE_REQUEST);
    await svc.delegate(BASE_REQUEST);
    svc.markCompleted("sub-1", "done", 0.01);

    const all = svc.getAllDelegations();
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.subtask_id)).toContain("sub-1");
    expect(all.map((d) => d.subtask_id)).toContain("sub-2");
  });
});
