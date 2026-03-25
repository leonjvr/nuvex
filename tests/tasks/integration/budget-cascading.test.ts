/**
 * Integration: Budget cascading
 *
 * Parent has $1.00 budget.
 * Decomposes into 3 children with $0.30 each ($0.90 total) → passes.
 * Try decomposition with $0.40 each ($1.20) → rejected.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore }          from "../../../src/tasks/store.js";
import { DecompositionValidator } from "../../../src/tasks/decomposition.js";
import type { Database } from "../../../src/utils/db.js";
import type { Task, CreateTaskInput } from "../../../src/tasks/types.js";

let tmpDir: string;
let db: Database;
let store: TaskStore;
let validator: DecompositionValidator;

beforeEach(() => {
  tmpDir    = mkdtempSync(join(tmpdir(), "sidjua-budget-test-"));
  db        = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store     = new TaskStore(db);
  store.initialize();
  validator = new DecompositionValidator();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeParentWithBudget(tokenBudget: number, costBudget: number): Task {
  return store.create({
    title: "Parent", description: "d", division: "engineering",
    type: "root", tier: 1,
    token_budget: tokenBudget,
    cost_budget: costBudget,
  });
}

function childInput(tokenBudget: number, costBudget: number): CreateTaskInput {
  return {
    title: "Child", description: "d", division: "engineering",
    type: "delegation", tier: 2,
    token_budget: tokenBudget,
    cost_budget: costBudget,
  };
}

describe("Budget cascading validation", () => {
  it("allows 3 children with $0.30 each ($0.90 total of $1.00 budget)", () => {
    const parent = makeParentWithBudget(10000, 1.0);
    const children = [
      childInput(2000, 0.30),
      childInput(2000, 0.30),
      childInput(2000, 0.30),
    ];

    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
    // $0.90 of $1.00 = 90% — not strictly >90%, so no warning expected
    // (warning triggers only when totalCost > parent * 0.9)
  });

  it("warns when 3 children consume >90% of $1.00 budget ($0.31 each = $0.93)", () => {
    const parent = makeParentWithBudget(10000, 1.0);
    const children = [
      childInput(2000, 0.31),
      childInput(2000, 0.31),
      childInput(2000, 0.31), // total $0.93 > $0.90 threshold
    ];

    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true); // within $1.00 budget
    expect(result.warnings.some((w) => w.includes(">90%"))).toBe(true);
  });

  it("rejects 3 children with $0.40 each ($1.20 total > $1.00 budget)", () => {
    const parent = makeParentWithBudget(10000, 1.0);
    const children = [
      childInput(2000, 0.40),
      childInput(2000, 0.40),
      childInput(2000, 0.40),
    ];

    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cost budget overflow"))).toBe(true);
  });

  it("accounts for already-spent budget when validating", () => {
    const parent = makeParentWithBudget(10000, 1.0);
    // Simulate parent has spent $0.50
    store.update(parent.id, { cost_used: 0.50 });
    const parentWithUsage = store.get(parent.id)!;

    // Remaining = $0.50; 3 children @ $0.20 each = $0.60 → overflow
    const children = [
      childInput(1000, 0.20),
      childInput(1000, 0.20),
      childInput(1000, 0.20),
    ];

    const result = validator.validate(parentWithUsage, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Cost budget overflow"))).toBe(true);
  });

  it("allows exactly equal budget (not over)", () => {
    const parent = makeParentWithBudget(10000, 1.0);
    const children = [
      childInput(3333, 0.333),
      childInput(3333, 0.333),
      childInput(3334, 0.334),
    ];

    const result = validator.validate(parent, children);
    expect(result.valid).toBe(true);
  });

  it("validates token budgets independently of cost budgets", () => {
    const parent = makeParentWithBudget(5000, 100.0); // low token, high cost
    const children = [
      childInput(3000, 0.1),
      childInput(3000, 0.1), // total tokens = 6000 > 5000
    ];

    const result = validator.validate(parent, children);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Token budget overflow"))).toBe(true);
  });

  it("T1 → T2 → T3 cascading: each level constrained by parent remaining", () => {
    // T1 has $1.00
    const t1 = makeParentWithBudget(10000, 1.0);

    // T2 gets $0.80 — valid (< $1.00)
    const t2Input = childInput(8000, 0.80);
    const t2Result = validator.validate(t1, [t2Input]);
    expect(t2Result.valid).toBe(true);

    // Create T2 with 0.80 budget
    const t2 = store.create({
      ...t2Input,
      parent_id: t1.id, root_id: t1.id,
    });

    // T3 tries to get $0.90 from T2's $0.80 → reject
    const t3Input = childInput(9000, 0.90);
    const t3Result = validator.validate(t2, [t3Input]);
    expect(t3Result.valid).toBe(false);
    expect(t3Result.errors.some((e) => e.includes("overflow"))).toBe(true);
  });
});
