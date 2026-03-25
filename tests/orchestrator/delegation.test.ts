/**
 * Tests for src/orchestrator/delegation.ts
 *
 * Covers:
 * - canDelegate: allowed/blocked directions, classification, tree depth
 * - validateDecomposition: breadth, budget, classification inheritance, tier validity
 * - allocateBudgets: proportional, fixed, remaining strategies + synthesis reserve
 */

import { describe, it, expect } from "vitest";
import { DelegationEngine } from "../../src/orchestrator/delegation.js";
import { DEFAULT_DELEGATION_RULES } from "../../src/orchestrator/types.js";
import type { OrchestratorConfig, TaskDecomposition } from "../../src/orchestrator/types.js";
import type { Task } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    max_agents:            10,
    max_agents_per_tier:   { 1: 2, 2: 4, 3: 8 },
    event_poll_interval_ms: 500,
    delegation_timeout_ms:  30_000,
    synthesis_timeout_ms:   300_000,
    max_tree_depth:         3,
    max_tree_breadth:       5,
    default_division:       "general",
    agent_definitions:      [],
    governance_root:        "/tmp/governance",
    delegation_rules:       DEFAULT_DELEGATION_RULES,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id:                  "task-1",
    parent_id:           null,
    root_id:             "task-1",
    division:            "engineering",
    type:                "root",
    tier:                1,
    title:               "Test task",
    description:         "Test",
    assigned_agent:      "agent-1",
    status:              "RUNNING",
    priority:            3,
    classification:      "internal",
    created_at:          "2026-01-01T00:00:00Z",
    updated_at:          "2026-01-01T00:00:00Z",
    started_at:          null,
    completed_at:        null,
    result_file:         null,
    result_summary:      null,
    confidence:          null,
    token_budget:        100_000,
    token_used:          10_000,
    cost_budget:         5.0,
    cost_used:           0.5,
    ttl_seconds:         3600,
    retry_count:         0,
    max_retries:         3,
    checkpoint:          null,
    sub_tasks_expected:  0,
    sub_tasks_received:  0,
    embedding_id:        null,
    metadata:            {},
    ...overrides,
  };
}

function makeChild(overrides: Partial<TaskDecomposition> = {}): TaskDecomposition {
  return {
    title:                "Child task",
    description:          "Do something",
    tier:                 2,
    priority:             3,
    capabilities_required: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canDelegate
// ---------------------------------------------------------------------------

describe("DelegationEngine.canDelegate", () => {
  it("allows T1 → T2", () => {
    const engine = new DelegationEngine(makeConfig());
    const task   = makeTask({ tier: 1 });
    const result = engine.canDelegate(1, 2, task);
    expect(result.allowed).toBe(true);
  });

  it("allows T2 → T3", () => {
    const engine = new DelegationEngine(makeConfig());
    const task   = makeTask({ tier: 2 });
    const result = engine.canDelegate(2, 3, task);
    expect(result.allowed).toBe(true);
  });

  it("allows T1 → T3 (skip-level)", () => {
    const engine = new DelegationEngine(makeConfig());
    const task   = makeTask({ tier: 1 });
    const result = engine.canDelegate(1, 3, task);
    expect(result.allowed).toBe(true);
  });

  it("blocks T3 → T2 (wrong direction)", () => {
    const engine = new DelegationEngine(makeConfig());
    const task   = makeTask({ tier: 3 });
    const result = engine.canDelegate(3, 2, task);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not allowed");
  });

  it("blocks T2 → T1 (wrong direction)", () => {
    const engine = new DelegationEngine(makeConfig());
    const task   = makeTask({ tier: 2 });
    const result = engine.canDelegate(2, 1, task);
    expect(result.allowed).toBe(false);
  });

  it("blocks when no rule exists for tier pair", () => {
    // Provide rules that don't cover T1→T2
    const engine = new DelegationEngine(makeConfig({
      delegation_rules: [
        { from_tier: 2, to_tier: 3, allowed: true, requires_classification_match: false, budget_cascade: "proportional" },
      ],
    }));
    const task   = makeTask({ tier: 1 });
    const result = engine.canDelegate(1, 2, task);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No delegation rule");
  });

  it("blocks when classification exceeds tier clearance", () => {
    const engine = new DelegationEngine(makeConfig());
    // T3 max clearance = INTERNAL (rank 1). SECRET = rank 3 → blocked
    const task = makeTask({ tier: 1, classification: "secret" });
    const result = engine.canDelegate(1, 3, task);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("clearance");
  });

  it("allows when classification within tier clearance", () => {
    const engine = new DelegationEngine(makeConfig());
    // T2 max clearance = CONFIDENTIAL (rank 2). INTERNAL (rank 1) → allowed
    const task = makeTask({ tier: 1, classification: "internal" });
    const result = engine.canDelegate(1, 2, task);
    expect(result.allowed).toBe(true);
  });

  it("blocks when tree depth limit exceeded", () => {
    const engine = new DelegationEngine(makeConfig({ max_tree_depth: 2 }));
    const task   = makeTask({ tier: 1 });
    // toTier = 3 > max_tree_depth = 2
    const result = engine.canDelegate(1, 3, task);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("depth");
  });

  it("allows peer consultation T2 ↔ T2", () => {
    const engine = new DelegationEngine(makeConfig());
    const task   = makeTask({ tier: 2 });
    const result = engine.canDelegate(2, 2, task);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateDecomposition
// ---------------------------------------------------------------------------

describe("DelegationEngine.validateDecomposition", () => {
  it("passes valid decomposition", () => {
    const engine = new DelegationEngine(makeConfig());
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0 });
    const children = [
      makeChild({ tier: 2, token_budget: 30_000, cost_budget: 3.0 }),
      makeChild({ tier: 2, token_budget: 30_000, cost_budget: 3.0 }),
    ];
    const result = engine.validateDecomposition(parent, children);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when too many sub-tasks (breadth limit)", () => {
    const engine = new DelegationEngine(makeConfig({ max_tree_breadth: 2 }));
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0 });
    const children = [
      makeChild({ tier: 2 }),
      makeChild({ tier: 2 }),
      makeChild({ tier: 2 }), // exceeds limit of 2
    ];
    const result = engine.validateDecomposition(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("max_tree_breadth"))).toBe(true);
  });

  it("fails when children token budgets exceed parent remaining", () => {
    const engine  = new DelegationEngine(makeConfig());
    const parent  = makeTask({ tier: 1, token_budget: 10_000, token_used: 2_000, cost_budget: 5.0, cost_used: 0 });
    // Available = 8000 - 10% reserve (1000) = 7000. Children ask for 8000.
    const children = [
      makeChild({ tier: 2, token_budget: 4_000 }),
      makeChild({ tier: 2, token_budget: 4_000 }),
    ];
    const result = engine.validateDecomposition(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("token budgets"))).toBe(true);
  });

  it("fails when children cost budgets exceed parent remaining", () => {
    const engine  = new DelegationEngine(makeConfig());
    const parent  = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 1.0, cost_used: 0.1 });
    // Available cost = 0.9 - 10% reserve (0.1) = 0.8. Children ask 0.9.
    const children = [
      makeChild({ tier: 2, cost_budget: 0.5 }),
      makeChild({ tier: 2, cost_budget: 0.4 }),
    ];
    const result = engine.validateDecomposition(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cost budgets"))).toBe(true);
  });

  it("fails when child tier is invalid for parent", () => {
    const engine  = new DelegationEngine(makeConfig());
    const parent  = makeTask({ tier: 3 }); // T3 cannot delegate to T2
    const children = [makeChild({ tier: 2 })];
    const result = engine.validateDecomposition(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tier"))).toBe(true);
  });

  it("passes when children have no specified budgets (proportional allocation)", () => {
    const engine = new DelegationEngine(makeConfig());
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0 });
    // Children without token_budget / cost_budget — no budget validation
    const children = [makeChild({ tier: 2 }), makeChild({ tier: 2 })];
    const result = engine.validateDecomposition(parent, children);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allocateBudgets
// ---------------------------------------------------------------------------

describe("DelegationEngine.allocateBudgets", () => {
  it("proportional: splits evenly among children", () => {
    const engine = new DelegationEngine(makeConfig());
    // parent: 100k tokens, 0 used. Available = 100k - 10k reserve = 90k → 30k each
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 3.0, cost_used: 0 });
    const children = [makeChild(), makeChild(), makeChild()];
    const result = engine.allocateBudgets(parent, children, "proportional");
    expect(result).toHaveLength(3);
    expect(result[0]!.token_budget).toBe(30_000);
    expect(result[0]!.cost_budget).toBeCloseTo(0.9, 5);
  });

  it("proportional: reserves 10% for synthesis", () => {
    const engine = new DelegationEngine(makeConfig());
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0 });
    const children = [makeChild()];
    const result = engine.allocateBudgets(parent, children, "proportional");
    // Available = 100k - 10k = 90k (10% reserve = 10k)
    expect(result[0]!.token_budget).toBe(90_000);
  });

  it("fixed: uses child-specified budgets", () => {
    const engine = new DelegationEngine(makeConfig());
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0 });
    const children = [
      makeChild({ token_budget: 20_000, cost_budget: 2.0 }),
      makeChild({ token_budget: 40_000, cost_budget: 4.0 }),
    ];
    const result = engine.allocateBudgets(parent, children, "fixed");
    expect(result[0]!.token_budget).toBe(20_000);
    expect(result[1]!.token_budget).toBe(40_000);
  });

  it("fixed: fills in defaults for children without budget", () => {
    const engine = new DelegationEngine(makeConfig());
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0 });
    const children = [makeChild()]; // no budget specified
    const result = engine.allocateBudgets(parent, children, "fixed");
    // Fallback = proportional (90000 / 1 = 90000)
    expect(result[0]!.token_budget).toBe(90_000);
  });

  it("remaining: first child gets 80% of available", () => {
    const engine = new DelegationEngine(makeConfig());
    // Available = 100k - 10k reserve = 90k. First child = 72k, rest split 18k
    const parent = makeTask({ tier: 1, token_budget: 100_000, token_used: 0, cost_budget: 10.0, cost_used: 0 });
    const children = [makeChild(), makeChild()];
    const result = engine.allocateBudgets(parent, children, "remaining");
    expect(result[0]!.token_budget).toBe(72_000);  // 90k * 0.8
    expect(result[1]!.token_budget).toBe(18_000);  // remaining
  });

  it("returns empty array for no children", () => {
    const engine = new DelegationEngine(makeConfig());
    const parent = makeTask({ tier: 1 });
    const result = engine.allocateBudgets(parent, [], "proportional");
    expect(result).toHaveLength(0);
  });
});
