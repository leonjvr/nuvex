// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P270 — Division Isolation + Persistence Hardening regression tests.
 *
 *   A2: DelegationService blocks cross-division delegations.
 *   B1: PendingDecisions save/get/mark-processed round-trip.
 *   B3: ResponseRouter persistOrigins / restoreOrigins round-trip.
 *   B4: DelegationService persistDelegations / restoreDelegations round-trip.
 *   B5: ProcessSupervisor persistState / restoreState round-trip.
 *   B6: Rate-limiter persist/restore wire (tested via existing rate-limiter helpers).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { DelegationService } from "../../src/delegation/delegation-service.js";
import type { TaskStoreLike, EventBusLike, AgentRegistryLike } from "../../src/delegation/delegation-service.js";
import type { DelegationPolicyResolver } from "../../src/delegation/policy-resolver.js";
import {
  savePendingDecision,
  getPendingDecisions,
  markDecisionProcessed,
  ensurePendingDecisionsTable,
} from "../../src/core/pending-decisions.js";
import { ResponseRouter } from "../../src/messaging/response-router.js";
import { ProcessSupervisor } from "../../src/agent-lifecycle/supervisor/process-supervisor.js";
import { persistRateLimiterState, restoreRateLimiterState, clearRateLimitState } from "../../src/api/middleware/rate-limiter.js";
import type { AdapterRegistry } from "../../src/messaging/adapter-registry.js";
import type { MessagingGovernance } from "../../src/messaging/types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeMemoryDb() {
  return new Database(":memory:");
}

function makeTaskStore(division = "engineering"): TaskStoreLike {
  return {
    get: vi.fn().mockReturnValue({
      id: "parent-1", cost_budget: 10, cost_used: 1, token_budget: 100_000,
      division, tier: 1, classification: "internal", sub_tasks_expected: 0,
    }),
    create: vi.fn().mockReturnValue({ id: "sub-1" }),
    update: vi.fn().mockReturnValue({ id: "parent-1" }),
  };
}

function makeEventBus(): EventBusLike {
  return { emit: vi.fn(), on: vi.fn() };
}

function makePolicy(allowed = true): DelegationPolicyResolver {
  return { canDelegate: vi.fn().mockReturnValue({ allowed, reason: allowed ? undefined : "policy_denied" }) };
}

/** Passthrough registry — agent not found, so division check passes. */
function makePassthroughRegistry(): AgentRegistryLike {
  return { getById: vi.fn().mockReturnValue(null) };
}

// ---------------------------------------------------------------------------
// A2: DelegationService division check
// ---------------------------------------------------------------------------

describe("A2: DelegationService — cross-division block", () => {
  it("allows same-division delegation when registry confirms match", async () => {
    const registry: AgentRegistryLike = {
      getById: vi.fn().mockReturnValue({ division: "engineering" }),
    };
    const svc = new DelegationService(makeTaskStore("engineering"), makeEventBus(), makePolicy(), registry);
    const result = await svc.delegate({
      source_agent_id: "agent-a", target_agent_id: "agent-b",
      parent_task_id: "parent-1", description: "do work",
      priority: 3, budget_usd: 1.0,
    });
    expect(result.success).toBe(true);
  });

  it("blocks cross-division delegation when target agent is in different division", async () => {
    const registry: AgentRegistryLike = {
      getById: vi.fn().mockReturnValue({ division: "product" }),
    };
    const svc = new DelegationService(makeTaskStore("engineering"), makeEventBus(), makePolicy(), registry);
    const result = await svc.delegate({
      source_agent_id: "agent-a", target_agent_id: "agent-b",
      parent_task_id: "parent-1", description: "cross-div task",
      priority: 3, budget_usd: 1.0,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("division_mismatch");
  });

  it("allows delegation when target agent not found in registry (unknown agent)", async () => {
    const registry: AgentRegistryLike = {
      getById: vi.fn().mockReturnValue(null),
    };
    const svc = new DelegationService(makeTaskStore("engineering"), makeEventBus(), makePolicy(), registry);
    const result = await svc.delegate({
      source_agent_id: "agent-a", target_agent_id: "unknown-agent",
      parent_task_id: "parent-1", description: "delegate to unknown",
      priority: 3, budget_usd: 1.0,
    });
    // If agent not found, don't block (can't verify, so allow through)
    expect(result.success).toBe(true);
  });

  it("throws at construction when agentRegistry is missing (P274 A3 — fail closed)", () => {
    // agentRegistry is now required — passing undefined throws immediately
    expect(() => {
      new DelegationService(
        makeTaskStore("engineering"),
        makeEventBus(),
        makePolicy(),
        undefined as unknown as AgentRegistryLike,
      );
    }).toThrow("agentRegistry");
  });
});

// ---------------------------------------------------------------------------
// B1: PendingDecisions
// ---------------------------------------------------------------------------

describe("B1: PendingDecisions — save / get / mark-processed", () => {
  it("savePendingDecision persists a record and getPendingDecisions returns it", () => {
    const db = makeMemoryDb();
    const id = savePendingDecision(db, "task-1", "approval", { approved: false });
    const pending = getPendingDecisions(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].task_id).toBe("task-1");
    expect(pending[0].type).toBe("approval");
    expect(pending[0].payload).toEqual({ approved: false });
    expect(pending[0].processed).toBe(false);
    db.close();
  });

  it("markDecisionProcessed removes decision from getPendingDecisions result", () => {
    const db = makeMemoryDb();
    const id = savePendingDecision(db, "task-2", "budget_override", { extra: 5 });
    markDecisionProcessed(db, id);
    const pending = getPendingDecisions(db);
    expect(pending).toHaveLength(0);
    db.close();
  });

  it("getPendingDecisions only returns unprocessed decisions", () => {
    const db = makeMemoryDb();
    const id1 = savePendingDecision(db, "task-3", "approval", {});
    const id2 = savePendingDecision(db, "task-4", "approval", {});
    markDecisionProcessed(db, id1);
    const pending = getPendingDecisions(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id2);
    db.close();
  });

  it("ensurePendingDecisionsTable is idempotent", () => {
    const db = makeMemoryDb();
    expect(() => {
      ensurePendingDecisionsTable(db);
      ensurePendingDecisionsTable(db);
    }).not.toThrow();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// B3: ResponseRouter persistence
// ---------------------------------------------------------------------------

describe("B3: ResponseRouter — persistOrigins / restoreOrigins", () => {
  function makeRouter(): ResponseRouter {
    const registry = {
      getInstance: vi.fn().mockReturnValue(undefined),
    } as unknown as AdapterRegistry;
    const governance: MessagingGovernance = {
      enabled: true, require_mapping: true,
      response_max_length: 4000, include_task_id_in_response: false,
      max_message_length: 2000, rate_limit_per_user_per_minute: 60,
    };
    return new ResponseRouter(registry, governance);
  }

  it("persistOrigins saves origins to DB; restoreOrigins loads them back", () => {
    const db = makeMemoryDb();
    const router1 = makeRouter();
    const envelope = {
      id: "msg-1", instance_id: "discord-1", platform: "discord",
      from: { id: "user-1", name: "Alice", username: "alice" },
      metadata: { chat_id: "chan-1", raw: {} },
      content: "hello", timestamp: new Date().toISOString(),
    } as import("../../src/messaging/types.js").MessageEnvelope;

    router1.registerTaskOrigin("task-xyz", envelope);
    router1.persistOrigins(db);

    const router2 = makeRouter();
    const count = router2.restoreOrigins(db);
    expect(count).toBe(1);
    expect(router2.pendingOrigins).toBe(1);
    db.close();
  });

  it("restoreOrigins on empty DB returns 0", () => {
    const db = makeMemoryDb();
    const router = makeRouter();
    const count = router.restoreOrigins(db);
    expect(count).toBe(0);
    expect(router.pendingOrigins).toBe(0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// B4: DelegationService persistence
// ---------------------------------------------------------------------------

describe("B4: DelegationService — persistDelegations / restoreDelegations", () => {
  it("persistDelegations saves active delegations; restoreDelegations loads them back", async () => {
    const db = makeMemoryDb();
    const svc1 = new DelegationService(makeTaskStore(), makeEventBus(), makePolicy(), makePassthroughRegistry());
    await svc1.delegate({
      source_agent_id: "agent-a", target_agent_id: "agent-b",
      parent_task_id: "parent-1", description: "task",
      priority: 3, budget_usd: 1.0,
    });
    expect(svc1.getAllDelegations()).toHaveLength(1);
    svc1.persistDelegations(db);

    const svc2 = new DelegationService(makeTaskStore(), makeEventBus(), makePolicy(), makePassthroughRegistry());
    const count = svc2.restoreDelegations(db);
    expect(count).toBe(1);
    expect(svc2.getAllDelegations()).toHaveLength(1);
    expect(svc2.getAllDelegations()[0].status).toBe("pending");
    db.close();
  });

  it("restoreDelegations on empty DB returns 0", () => {
    const db = makeMemoryDb();
    const svc = new DelegationService(makeTaskStore(), makeEventBus(), makePolicy(), makePassthroughRegistry());
    expect(svc.restoreDelegations(db)).toBe(0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// B5: ProcessSupervisor persistence
// ---------------------------------------------------------------------------

describe("B5: ProcessSupervisor — persistState / restoreState", () => {
  it("persistState saves agent state; restoreState loads it back", () => {
    const db = makeMemoryDb();
    const sup1 = new ProcessSupervisor();
    sup1.registerAgent("agent-x");
    sup1.recordHeartbeat("agent-x");
    sup1.persistState(db);

    const sup2 = new ProcessSupervisor();
    const count = sup2.restoreState(db);
    expect(count).toBe(1);
    expect(sup2.getAgentStatus("agent-x")).toBeDefined();
    db.close();
  });

  it("restoreState on empty DB returns 0", () => {
    const db = makeMemoryDb();
    const sup = new ProcessSupervisor();
    expect(sup.restoreState(db)).toBe(0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// B6: Rate-limiter persist/restore wire
// ---------------------------------------------------------------------------

describe("B6: Rate-limiter — persistRateLimiterState / restoreRateLimiterState", () => {
  beforeEach(() => clearRateLimitState());

  it("persistRateLimiterState and restoreRateLimiterState are exported functions", () => {
    expect(typeof persistRateLimiterState).toBe("function");
    expect(typeof restoreRateLimiterState).toBe("function");
  });

  it("restoreRateLimiterState returns 0 on empty DB", () => {
    const db = makeMemoryDb();
    const count = restoreRateLimiterState(db);
    expect(count).toBe(0);
    db.close();
  });
});
