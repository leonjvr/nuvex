/**
 * Unit tests: PolicyValidator
 */

import { describe, it, expect } from "vitest";
import { PolicyValidator } from "../../../src/knowledge-pipeline/policy/policy-validator.js";
import type { PolicyRuleDB, PolicyRuleInput } from "../../../src/knowledge-pipeline/types.js";

function makeRule(overrides: Partial<PolicyRuleDB> & { id: number }): PolicyRuleDB {
  return {
    source_file: "governance/test.yaml",
    rule_type: "forbidden",
    enforcement: "block",
    active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("PolicyValidator", () => {
  let validator: PolicyValidator;

  // vitest doesn't require beforeEach for a simple new instance
  validator = new PolicyValidator();

  it("returns valid=true when no rules are provided", () => {
    const result = validator.validate([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(result.dead_rules).toHaveLength(0);
  });

  it("returns valid=true for a single active rule with no conflicts", () => {
    const rules: PolicyRuleDB[] = [
      makeRule({ id: 1, action_pattern: "delete files/*", enforcement: "block" }),
    ];
    const result = validator.validate(rules);
    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
    expect(result.dead_rules).toHaveLength(0);
  });

  it("detects conflict: same action_pattern where one is block and one is log", () => {
    const rules: PolicyRuleDB[] = [
      makeRule({ id: 1, action_pattern: "export data/*", enforcement: "block" }),
      makeRule({ id: 2, action_pattern: "export data/*", enforcement: "log" }),
    ];
    const result = validator.validate(rules);
    expect(result.valid).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.rule_a_id).toBe(1);
    expect(result.conflicts[0]!.rule_b_id).toBe(2);
    expect(result.errors).toHaveLength(1);
  });

  it("marks inactive rule as dead (never matches)", () => {
    const rules: PolicyRuleDB[] = [
      makeRule({ id: 10, action_pattern: "read files/*", enforcement: "log", active: false }),
    ];
    const result = validator.validate(rules);
    expect(result.dead_rules).toContain(10);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("wildcard * block rule shadows a specific action_pattern rule — marks specific as dead", () => {
    const rules: PolicyRuleDB[] = [
      makeRule({ id: 5, action_pattern: "*", enforcement: "block" }),
      makeRule({ id: 6, action_pattern: "delete originals/*", enforcement: "warn" }),
    ];
    const result = validator.validate(rules);
    // Rule 6 is shadowed because rule 5 blocks everything and rule 6 is not a block rule
    expect(result.dead_rules).toContain(6);
    expect(result.dead_rules).not.toContain(5);
    // The wildcard rule itself is not dead (it is a block rule)
  });

  it("validate(rules, newRule) returns valid=false when new rule conflicts with existing", () => {
    const rules: PolicyRuleDB[] = [
      makeRule({ id: 20, action_pattern: "send external/*", enforcement: "block" }),
    ];
    const newRule: PolicyRuleInput = {
      source_file: "governance/new.yaml",
      rule_type: "custom",
      action_pattern: "send external/*",
      enforcement: "log",
    };
    const result = validator.validate(rules, newRule);
    expect(result.valid).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.rule_a_id).toBe(20);
    expect(result.conflicts[0]!.rule_b_id).toBe("new");
  });

  it("does NOT flag conflict when both rules have the same enforcement", () => {
    const rules: PolicyRuleDB[] = [
      makeRule({ id: 30, action_pattern: "export files/*", enforcement: "block" }),
      makeRule({ id: 31, action_pattern: "export files/*", enforcement: "block" }),
    ];
    const result = validator.validate(rules);
    // Same enforcement is not a conflict per the implementation
    expect(result.conflicts).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it("does NOT flag inactive rules as conflicts with each other", () => {
    const rules: PolicyRuleDB[] = [
      makeRule({ id: 40, action_pattern: "send data/*", enforcement: "block", active: false }),
      makeRule({ id: 41, action_pattern: "send data/*", enforcement: "log", active: false }),
    ];
    const result = validator.validate(rules);
    // Conflicts require both rules to be active
    expect(result.conflicts).toHaveLength(0);
  });
});
