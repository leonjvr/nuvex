// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * DelegationPolicyResolver — unit tests
 *
 * Test cases:
 *   1. T3 agent resolves policy with empty can_delegate_to
 *   2. T1 agent can delegate to T2 and T3 agents in same division
 *   3. Unknown source agent → denied
 *   4. T3 agent → canDelegate returns allowed: false (source_tier_too_low)
 *   5. T1 cannot delegate upward (to another T1 = same tier, allowed; to T0 = N/A in V1.0)
 *   6. Cannot self-delegate
 *   7. canDelegate disabled when config.enabled = false
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DelegationPolicyResolver } from "../../src/delegation/policy-resolver.js";
import type { AgentRegistryLike }  from "../../src/delegation/policy-resolver.js";

// ---------------------------------------------------------------------------
// Minimal test registry
// ---------------------------------------------------------------------------

function makeRegistry(
  agents: Array<{ id: string; tier: number; division: string; status: string }>,
): AgentRegistryLike {
  return {
    getById: (id) => agents.find((a) => a.id === id),
    list:    (f)  => f?.status
      ? agents.filter((a) => a.status === f.status)
      : agents,
  };
}

// ---------------------------------------------------------------------------
// Tests: resolvePolicy
// ---------------------------------------------------------------------------

describe("DelegationPolicyResolver — resolvePolicy", () => {
  it("T3 agent gets empty can_delegate_to (cannot delegate)", () => {
    const registry = makeRegistry([
      { id: "agent-t3", tier: 3, division: "engineering", status: "active" },
      { id: "agent-t2", tier: 2, division: "engineering", status: "active" },
    ]);
    const resolver = new DelegationPolicyResolver(registry);

    const policy = resolver.resolvePolicy("agent-t3");

    expect(policy.agent_id).toBe("agent-t3");
    expect(policy.can_delegate_to).toHaveLength(0);
    expect(policy.max_subtasks).toBe(0);
  });

  it("T1 agent can delegate to T2 and T3 active agents", () => {
    const registry = makeRegistry([
      { id: "agent-t1", tier: 1, division: "ops",         status: "active" },
      { id: "agent-t2", tier: 2, division: "engineering", status: "active" },
      { id: "agent-t3", tier: 3, division: "hr",          status: "active" },
      { id: "agent-idle", tier: 2, division: "ops",       status: "idle"   },
    ]);
    const resolver = new DelegationPolicyResolver(registry);

    const policy = resolver.resolvePolicy("agent-t1");

    // T1 can delegate to T2, T3 (tier >= 1), active only
    expect(policy.can_delegate_to).toContain("agent-t2");
    expect(policy.can_delegate_to).toContain("agent-t3");
    // Inactive agent excluded
    expect(policy.can_delegate_to).not.toContain("agent-idle");
    // Cannot self-delegate
    expect(policy.can_delegate_to).not.toContain("agent-t1");
  });

  it("unknown agent gets no-delegation policy", () => {
    const registry = makeRegistry([]);
    const resolver = new DelegationPolicyResolver(registry);

    const policy = resolver.resolvePolicy("ghost-agent");

    expect(policy.can_delegate_to).toHaveLength(0);
    expect(policy.max_subtasks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: canDelegate
// ---------------------------------------------------------------------------

describe("DelegationPolicyResolver — canDelegate", () => {
  let registry: AgentRegistryLike;
  let resolver: DelegationPolicyResolver;

  beforeEach(() => {
    registry = makeRegistry([
      { id: "t1-manager", tier: 1, division: "ops",         status: "active" },
      { id: "t2-worker",  tier: 2, division: "engineering", status: "active" },
      { id: "t3-exec",    tier: 3, division: "engineering", status: "active" },
    ]);
    resolver = new DelegationPolicyResolver(registry);
  });

  it("T1 can delegate to T2", () => {
    const result = resolver.canDelegate("t1-manager", "t2-worker");
    expect(result.allowed).toBe(true);
  });

  it("T1 can delegate to T3", () => {
    const result = resolver.canDelegate("t1-manager", "t3-exec");
    expect(result.allowed).toBe(true);
  });

  it("T3 cannot delegate (source_tier_too_low)", () => {
    const result = resolver.canDelegate("t3-exec", "t2-worker");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("source_tier_too_low");
  });

  it("cannot delegate upward (T2 to T1)", () => {
    const result = resolver.canDelegate("t2-worker", "t1-manager");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cannot_delegate_upward");
  });

  it("cannot self-delegate", () => {
    const result = resolver.canDelegate("t1-manager", "t1-manager");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cannot_self_delegate");
  });

  it("source agent not found → denied", () => {
    const result = resolver.canDelegate("ghost-agent", "t2-worker");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("source_agent_not_found");
  });

  it("target agent not found → denied", () => {
    const result = resolver.canDelegate("t1-manager", "ghost-agent");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("target_agent_not_found");
  });

  it("delegation disabled via config → denied", () => {
    const disabledResolver = new DelegationPolicyResolver(registry, { enabled: false });
    const result = disabledResolver.canDelegate("t1-manager", "t2-worker");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("delegation_disabled");
  });
});

// ---------------------------------------------------------------------------
// Tests: listDelegatableAgents
// ---------------------------------------------------------------------------

describe("DelegationPolicyResolver — listDelegatableAgents", () => {
  it("filters by division when provided", () => {
    const registry = makeRegistry([
      { id: "t1-ops",    tier: 1, division: "ops",         status: "active" },
      { id: "t2-eng",    tier: 2, division: "engineering", status: "active" },
      { id: "t2-ops",    tier: 2, division: "ops",         status: "active" },
    ]);
    const resolver = new DelegationPolicyResolver(registry);

    const results = resolver.listDelegatableAgents("t1-ops", "ops");

    expect(results.map((a) => a.id)).toContain("t2-ops");
    expect(results.map((a) => a.id)).not.toContain("t2-eng");
  });

  it("returns empty array for T3 agent", () => {
    const registry = makeRegistry([
      { id: "t3-exec", tier: 3, division: "ops", status: "active" },
      { id: "t2-ops",  tier: 2, division: "ops", status: "active" },
    ]);
    const resolver = new DelegationPolicyResolver(registry);

    const results = resolver.listDelegatableAgents("t3-exec");
    expect(results).toHaveLength(0);
  });
});
