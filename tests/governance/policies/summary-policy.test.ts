/**
 * Tests for src/governance/policies/summary-policy.ts — Phase 14
 */

import { describe, it, expect } from "vitest";
import { SummaryPolicyValidator } from "../../../src/governance/policies/summary-policy.js";
import type { CreateSummaryInput } from "../../../src/tasks/summary-store.js";

function validInput(overrides: Partial<CreateSummaryInput> = {}): CreateSummaryInput {
  return {
    task_id:      "t1",
    agent_id:     "a1",
    summary_text: "Task completed successfully.",
    key_facts:    ["Revenue increased 10%"],
    status:       "completed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

describe("SummaryPolicyValidator with default policy", () => {
  const validator = new SummaryPolicyValidator();

  it("returns valid=true for valid input", () => {
    const result = validator.validate(validInput());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns SUMMARY-001 for missing key_facts", () => {
    const result = validator.validate(validInput({ key_facts: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SUMMARY-001")).toBe(true);
  });

  it("returns SUMMARY-002 for invalid status", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = validator.validate(validInput({ status: "unknown" as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SUMMARY-002")).toBe(true);
  });

  it("returns SUMMARY-003 for oversized summary_text", () => {
    const result = validator.validate(validInput({ summary_text: "x".repeat(8001) }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SUMMARY-003")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Custom policy
// ---------------------------------------------------------------------------

describe("SummaryPolicyValidator with custom policy (min_key_facts: 3)", () => {
  const validator = new SummaryPolicyValidator({ min_key_facts: 3, max_summary_length: 4000 });

  it("enforces stricter min_key_facts", () => {
    const result = validator.validate(validInput({ key_facts: ["only one fact"] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SUMMARY-001")).toBe(true);
  });

  it("accepts input with 3+ key_facts", () => {
    const result = validator.validate(
      validInput({ key_facts: ["f1", "f2", "f3"] }),
    );
    expect(result.valid).toBe(true);
  });
});
