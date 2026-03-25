/**
 * Tests for src/pipeline/condition-parser.ts
 */

import { describe, it, expect } from "vitest";
import {
  parseCondition,
  evaluateCondition,
  resolveField,
  compareValues,
} from "../../src/pipeline/condition-parser.js";
import type { ActionRequest } from "../../src/types/pipeline.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<{
  actionType:      string;
  target:          string;
  estimatedCost:   number;
  dataClass:       string;
  divisionCode:    string;
  targetDivision:  string;
  agentTier:       1 | 2 | 3;
  agentId:         string;
  parameters:      Record<string, unknown>;
}>  = {}): ActionRequest {
  return {
    request_id:  "req-001",
    timestamp:   "2026-02-27T00:00:00Z",
    agent_id:    overrides.agentId      ?? "agent-1",
    agent_tier:  overrides.agentTier    ?? 2,
    division_code: overrides.divisionCode ?? "engineering",
    action: {
      type:                  overrides.actionType      ?? "file.read",
      target:                overrides.target          ?? "/some/file.txt",
      description:           "test action",
      estimated_cost_usd:    overrides.estimatedCost,
      data_classification:   overrides.dataClass as ActionRequest["action"]["data_classification"],
      parameters:            overrides.parameters,
    },
    context: {
      division_code:   overrides.divisionCode   ?? "engineering",
      target_division: overrides.targetDivision,
      session_id:      "sess-001",
    },
  };
}

// ---------------------------------------------------------------------------
// parseCondition
// ---------------------------------------------------------------------------

describe("parseCondition", () => {
  it("parses numeric comparison", () => {
    const parsed = parseCondition("amount_usd > 500");
    expect(parsed.field).toBe("amount_usd");
    expect(parsed.operator).toBe(">");
    expect(parsed.value).toBe(500);
    expect(parsed.valueIsFieldRef).toBe(false);
  });

  it("parses single-quoted string", () => {
    const parsed = parseCondition("target contains 'audit'");
    expect(parsed.field).toBe("target");
    expect(parsed.operator).toBe("contains");
    expect(parsed.value).toBe("audit");
    expect(parsed.valueIsFieldRef).toBe(false);
  });

  it("parses double-quoted string", () => {
    const parsed = parseCondition('parameters.intent != "deceptive"');
    expect(parsed.field).toBe("parameters.intent");
    expect(parsed.operator).toBe("!=");
    expect(parsed.value).toBe("deceptive");
    expect(parsed.valueIsFieldRef).toBe(false);
  });

  it("parses boolean true literal", () => {
    const parsed = parseCondition("parameters.contains_pii != true");
    expect(parsed.field).toBe("parameters.contains_pii");
    expect(parsed.operator).toBe("!=");
    expect(parsed.value).toBe(true);
    expect(parsed.valueIsFieldRef).toBe(false);
  });

  it("parses boolean false literal", () => {
    const parsed = parseCondition("parameters.active == false");
    expect(parsed.value).toBe(false);
    expect(parsed.valueIsFieldRef).toBe(false);
  });

  it("parses field reference (unquoted identifier)", () => {
    const parsed = parseCondition("target_division != division_code");
    expect(parsed.field).toBe("target_division");
    expect(parsed.operator).toBe("!=");
    expect(parsed.value).toBe("division_code");
    expect(parsed.valueIsFieldRef).toBe(true);
  });

  it("parses >= operator", () => {
    const parsed = parseCondition("estimated_cost_usd >= 1.5");
    expect(parsed.operator).toBe(">=");
    expect(parsed.value).toBe(1.5);
  });

  it("parses <= operator", () => {
    const parsed = parseCondition("agent_tier <= 2");
    expect(parsed.operator).toBe("<=");
    expect(parsed.value).toBe(2);
  });

  it("parses == operator", () => {
    const parsed = parseCondition("division_code == 'legal'");
    expect(parsed.operator).toBe("==");
    expect(parsed.value).toBe("legal");
  });

  it("throws on missing value token", () => {
    expect(() => parseCondition("amount_usd >")).toThrow();
  });

  it("throws on unknown operator", () => {
    expect(() => parseCondition("amount_usd LIKE '500'")).toThrow();
  });

  it("throws on too few tokens", () => {
    expect(() => parseCondition("amount_usd")).toThrow();
    expect(() => parseCondition("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveField
// ---------------------------------------------------------------------------

describe("resolveField", () => {
  it("resolves action target", () => {
    const req = makeRequest({ target: "/data/audit.log" });
    expect(resolveField("target", req)).toBe("/data/audit.log");
  });

  it("resolves estimated_cost_usd", () => {
    const req = makeRequest({ estimatedCost: 2.5 });
    expect(resolveField("estimated_cost_usd", req)).toBe(2.5);
  });

  it("resolves amount_usd alias", () => {
    const req = makeRequest({ estimatedCost: 3.0 });
    expect(resolveField("amount_usd", req)).toBe(3.0);
  });

  it("resolves division_code from context", () => {
    const req = makeRequest({ divisionCode: "legal" });
    expect(resolveField("division_code", req)).toBe("legal");
  });

  it("resolves target_division from context", () => {
    const req = makeRequest({ divisionCode: "engineering", targetDivision: "finance" });
    expect(resolveField("target_division", req)).toBe("finance");
  });

  it("resolves agent_tier", () => {
    const req = makeRequest({ agentTier: 1 });
    expect(resolveField("agent_tier", req)).toBe(1);
  });

  it("resolves parameters.intent", () => {
    const req = makeRequest({ parameters: { intent: "deceptive" } });
    expect(resolveField("parameters.intent", req)).toBe("deceptive");
  });

  it("resolves parameters.contains_pii", () => {
    const req = makeRequest({ parameters: { contains_pii: true } });
    expect(resolveField("parameters.contains_pii", req)).toBe(true);
  });

  it("returns undefined for unknown field", () => {
    const req = makeRequest();
    expect(resolveField("nonexistent_field", req)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// compareValues
// ---------------------------------------------------------------------------

describe("compareValues", () => {
  it("> numeric: true when field > compare", () => {
    expect(compareValues(10, ">", 5)).toBe(true);
    expect(compareValues(5,  ">", 10)).toBe(false);
    expect(compareValues(5,  ">", 5)).toBe(false);
  });

  it("< numeric: true when field < compare", () => {
    expect(compareValues(3, "<", 10)).toBe(true);
    expect(compareValues(10, "<", 3)).toBe(false);
  });

  it(">= numeric: true when field >= compare", () => {
    expect(compareValues(5, ">=", 5)).toBe(true);
    expect(compareValues(6, ">=", 5)).toBe(true);
    expect(compareValues(4, ">=", 5)).toBe(false);
  });

  it("<= numeric: true when field <= compare", () => {
    expect(compareValues(5, "<=", 5)).toBe(true);
    expect(compareValues(4, "<=", 5)).toBe(true);
    expect(compareValues(6, "<=", 5)).toBe(false);
  });

  it("> returns false for non-numeric values", () => {
    expect(compareValues("a", ">", "b")).toBe(false);
    expect(compareValues(null, ">", 5)).toBe(false);
  });

  it("== uses string coercion", () => {
    expect(compareValues("deceptive", "==", "deceptive")).toBe(true);
    expect(compareValues("x",         "==", "y")).toBe(false);
    expect(compareValues(true,        "==", "true")).toBe(true);
  });

  it("!= uses string coercion", () => {
    expect(compareValues("a", "!=", "b")).toBe(true);
    expect(compareValues("a", "!=", "a")).toBe(false);
    expect(compareValues(true, "!=", "false")).toBe(true);
  });

  it("contains: true when field string includes value", () => {
    expect(compareValues("audit_log", "contains", "audit")).toBe(true);
    expect(compareValues("access.log", "contains", "audit")).toBe(false);
  });

  it("contains: false for non-string operands", () => {
    expect(compareValues(42,   "contains", "4")).toBe(false);
    expect(compareValues("a",  "contains", 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition (integration)
// ---------------------------------------------------------------------------

describe("evaluateCondition", () => {
  it("returns true for cost above threshold", () => {
    const req = makeRequest({ estimatedCost: 600 });
    expect(evaluateCondition("amount_usd > 500", req)).toBe(true);
  });

  it("returns false for cost below threshold", () => {
    const req = makeRequest({ estimatedCost: 100 });
    expect(evaluateCondition("amount_usd > 500", req)).toBe(false);
  });

  it("evaluates target contains check", () => {
    const req = makeRequest({ target: "/data/audit_trail.db" });
    expect(evaluateCondition("target contains 'audit'", req)).toBe(true);
  });

  it("evaluates cross-division field reference", () => {
    const req = makeRequest({ divisionCode: "engineering", targetDivision: "finance" });
    expect(evaluateCondition("target_division != division_code", req)).toBe(true);
  });

  it("field reference evaluates to equal values", () => {
    const req = makeRequest({ divisionCode: "engineering", targetDivision: "engineering" });
    expect(evaluateCondition("target_division != division_code", req)).toBe(false);
  });

  it("evaluates parameters nested field", () => {
    const req = makeRequest({ parameters: { intent: "deceptive" } });
    expect(evaluateCondition("parameters.intent != 'deceptive'", req)).toBe(false);
  });

  it("returns true (fail-closed) for unparseable condition (P274 A4)", () => {
    const req = makeRequest();
    expect(evaluateCondition("", req)).toBe(true);
    expect(evaluateCondition("invalid LIKE syntax", req)).toBe(true);
  });

  it("returns false (fail-open) for missing field", () => {
    const req = makeRequest();
    expect(evaluateCondition("amount_usd > 500", req)).toBe(false);
  });

  it("evaluates parameters.contains_pii != true", () => {
    const reqTrue  = makeRequest({ parameters: { contains_pii: true } });
    const reqFalse = makeRequest({ parameters: { contains_pii: false } });
    expect(evaluateCondition("parameters.contains_pii != true", reqTrue)).toBe(false);
    expect(evaluateCondition("parameters.contains_pii != true", reqFalse)).toBe(true);
  });
});
