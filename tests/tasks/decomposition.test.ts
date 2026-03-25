/**
 * Tests for src/tasks/decomposition.ts
 *
 * Covers:
 * - Valid decomposition passes (T1→T2)
 * - Invalid tier skip rejected (T1→T3)
 * - T3 cannot create children
 * - Budget overflow rejected
 * - Classification downgrade rejected
 * - Breadth limit enforced
 * - Consultation limit enforced
 * - Division boundary enforced
 * - Cross-tier consultation rejected
 */

import { describe, it, expect } from "vitest";
import { DecompositionValidator } from "../../src/tasks/decomposition.js";
import type { Task, CreateTaskInput } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParent(overrides: Partial<Task> = {}): Task {
  return {
    id:                  "parent-id",
    parent_id:           null,
    root_id:             "parent-id",
    division:            "engineering",
    type:                "root",
    tier:                1,
    title:               "Parent task",
    description:         "Parent description",
    assigned_agent:      "agent-1",
    status:              "RUNNING",
    priority:            3,
    classification:      "internal",
    created_at:          "2026-01-01T00:00:00Z",
    updated_at:          "2026-01-01T00:00:00Z",
    started_at:          "2026-01-01T00:00:00Z",
    completed_at:        null,
    result_file:         null,
    result_summary:      null,
    confidence:          null,
    token_budget:        10_000,
    token_used:          0,
    cost_budget:         1.0,
    cost_used:           0.0,
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

function makeChild(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title:        "Child task",
    description:  "Child description",
    division:     "engineering",
    type:         "delegation",
    tier:         2,
    token_budget: 2000,
    cost_budget:  0.2,
    ...overrides,
  };
}

const validator = new DecompositionValidator();

// ---------------------------------------------------------------------------
// Valid decomposition
// ---------------------------------------------------------------------------

describe("DecompositionValidator — valid decompositions", () => {
  it("accepts T1→T2 delegation", () => {
    const parent = makeParent({ tier: 1 });
    const children = [makeChild({ tier: 2 }), makeChild({ tier: 2 })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts T2→T3 delegation", () => {
    const parent = makeParent({ tier: 2 });
    const children = [makeChild({ tier: 3 })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });

  it("accepts empty children with warning", () => {
    const parent = makeParent();
    const result = validator.validate(parent, []);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("no child tasks"))).toBe(true);
  });

  it("accepts consultation at same tier as parent", () => {
    const parent = makeParent({ tier: 2 });
    const children = [makeChild({ tier: 2, type: "consultation" })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier enforcement
// ---------------------------------------------------------------------------

describe("DecompositionValidator — tier enforcement", () => {
  it("rejects T1→T3 (tier skip)", () => {
    const parent = makeParent({ tier: 1 });
    const children = [makeChild({ tier: 3 })]; // skip T2
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tier must be 2"))).toBe(true);
  });

  it("rejects T2→T1 (backward tier)", () => {
    const parent = makeParent({ tier: 2 });
    const children = [makeChild({ tier: 1 })]; // backward
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
  });

  it("rejects T3 creating any children", () => {
    const parent = makeParent({ tier: 3 });
    const children = [makeChild({ tier: 4 as 1 | 2 | 3 })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("T3 tasks cannot create"))).toBe(true);
  });

  it("rejects consultation at wrong tier", () => {
    const parent = makeParent({ tier: 2 });
    const children = [makeChild({ tier: 3, type: "consultation" })]; // wrong tier for peer
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("consultation tier must match"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Budget cascading
// ---------------------------------------------------------------------------

describe("DecompositionValidator — budget cascading", () => {
  it("rejects when children token budgets exceed parent remaining", () => {
    const parent = makeParent({ token_budget: 5000, token_used: 0 });
    const children = [
      makeChild({ token_budget: 3000 }),
      makeChild({ token_budget: 3000 }), // total = 6000 > 5000
    ];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Token budget overflow"))).toBe(true);
  });

  it("rejects when children cost budgets exceed parent remaining", () => {
    const parent = makeParent({ cost_budget: 1.0, cost_used: 0 });
    const children = [
      makeChild({ token_budget: 100, cost_budget: 0.6 }),
      makeChild({ token_budget: 100, cost_budget: 0.6 }), // total = 1.2 > 1.0
    ];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cost budget overflow"))).toBe(true);
  });

  it("allows when total exactly equals parent remaining", () => {
    const parent = makeParent({ token_budget: 5000, token_used: 0, cost_budget: 1.0, cost_used: 0 });
    const children = [
      makeChild({ token_budget: 2500, cost_budget: 0.5 }),
      makeChild({ token_budget: 2500, cost_budget: 0.5 }),
    ];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });

  it("accounts for already-used budget in parent", () => {
    const parent = makeParent({ token_budget: 10000, token_used: 5000 });
    // Remaining = 5000; children request 6000 → overflow
    const children = [
      makeChild({ token_budget: 3000 }),
      makeChild({ token_budget: 3000 }),
    ];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Token budget overflow"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Classification inheritance
// ---------------------------------------------------------------------------

describe("DecompositionValidator — classification", () => {
  it("rejects child with less restrictive classification", () => {
    const parent = makeParent({ classification: "confidential" });
    const children = [makeChild({ classification: "internal" })]; // less restrictive
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("less restrictive"))).toBe(true);
  });

  it("allows child with same classification", () => {
    const parent = makeParent({ classification: "confidential" });
    const children = [makeChild({ classification: "confidential" })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });

  it("allows child with more restrictive classification", () => {
    const parent = makeParent({ classification: "internal" });
    const children = [makeChild({ classification: "secret" })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });

  it("rejects public child when parent is internal", () => {
    const parent = makeParent({ classification: "internal" });
    const children = [makeChild({ classification: "public" })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Division boundary
// ---------------------------------------------------------------------------

describe("DecompositionValidator — division boundary", () => {
  it("rejects cross-division children in V1", () => {
    const parent = makeParent({ division: "engineering" });
    const children = [makeChild({ division: "sales" })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cross-division"))).toBe(true);
  });

  it("allows same division", () => {
    const parent = makeParent({ division: "engineering" });
    const children = [makeChild({ division: "engineering" })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Breadth limit
// ---------------------------------------------------------------------------

describe("DecompositionValidator — breadth limit", () => {
  it("rejects more than 20 children", () => {
    const parent = makeParent({ token_budget: 1_000_000, cost_budget: 1000 });
    const children = Array.from({ length: 21 }, () => makeChild({ token_budget: 100, cost_budget: 0.01 }));
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Breadth limit exceeded"))).toBe(true);
  });

  it("allows exactly 20 children", () => {
    const parent = makeParent({ token_budget: 1_000_000, cost_budget: 1000 });
    const children = Array.from({ length: 20 }, () => makeChild({ token_budget: 100, cost_budget: 0.01 }));
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Consultation limit
// ---------------------------------------------------------------------------

describe("DecompositionValidator — consultation limit", () => {
  it("rejects more than 3 consultations", () => {
    const parent = makeParent({ tier: 2, token_budget: 100_000, cost_budget: 100 });
    const consultations = Array.from({ length: 4 }, () =>
      makeChild({ tier: 2, type: "consultation", token_budget: 100, cost_budget: 0.01 }),
    );
    const result = validator.validate(parent, consultations);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Consultation limit exceeded"))).toBe(true);
  });

  it("allows exactly 3 consultations", () => {
    const parent = makeParent({ tier: 2, token_budget: 100_000, cost_budget: 100 });
    const consultations = Array.from({ length: 3 }, () =>
      makeChild({ tier: 2, type: "consultation", token_budget: 100, cost_budget: 0.01 }),
    );
    const result = validator.validate(parent, consultations);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

describe("DecompositionValidator — warnings", () => {
  it("warns when children consume >90% of parent token budget", () => {
    const parent = makeParent({ token_budget: 10000, cost_budget: 10 });
    const children = [makeChild({ token_budget: 9500, cost_budget: 0.1 })];
    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes(">90%"))).toBe(true);
  });
});
