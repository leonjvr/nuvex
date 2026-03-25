/**
 * Tests for src/pipeline/policy.ts — Stage 5
 *
 * Checklist items covered:
 *   ✓ Hard policy violation → BLOCK
 *   ✓ Soft policy violation → WARN + continue
 */

import { describe, it, expect } from "vitest";
import { checkPolicy } from "../../src/pipeline/policy.js";
import type { ActionRequest, PolicyConfig } from "../../src/types/pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(type: string, parameters?: Record<string, unknown>, overrides: Partial<{
  targetDivision: string;
  divisionCode:   string;
}> = {}): ActionRequest {
  return {
    request_id:    "req-001",
    timestamp:     "2026-02-27T00:00:00Z",
    agent_id:      "agent-1",
    agent_tier:    2,
    division_code: overrides.divisionCode ?? "engineering",
    action: {
      type,
      target:      "/target",
      description: "test",
      parameters,
    },
    context: {
      division_code:   overrides.divisionCode   ?? "engineering",
      target_division: overrides.targetDivision,
      session_id:      "sess-001",
    },
  };
}

const policies: PolicyConfig[] = [
  {
    source_file: "governance/policies/ethics.yaml",
    rules: [
      {
        id:           "no_deception",
        description:  "Agents must not create deceptive content",
        action_types: ["email.send", "message.send", "web.post"],
        check:        "parameters.intent != 'deceptive'",
        enforcement:  "hard",
      },
      {
        id:           "human_oversight",
        description:  "Critical decisions require human notification",
        action_types: ["contract.*", "purchase.*", "data.delete"],
        check:        "always",
        enforcement:  "hard",
      },
    ],
  },
  {
    source_file: "governance/policies/data-handling.yaml",
    rules: [
      {
        id:           "no_pii_export",
        description:  "No PII in external communications",
        action_types: ["email.send", "web.post", "data.export"],
        check:        "parameters.contains_pii != true",
        enforcement:  "hard",
      },
      {
        id:           "log_external_access",
        description:  "Log all external data access",
        action_types: ["web.fetch", "api.call"],
        check:        "always",
        enforcement:  "soft",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkPolicy — Stage 5", () => {
  it("PASS: action not covered by any policy", () => {
    const result = checkPolicy(makeRequest("file.write"), policies);
    expect(result.verdict).toBe("PASS");
  });

  it("PASS: email.send with non-deceptive intent and no PII", () => {
    const result = checkPolicy(
      makeRequest("email.send", { intent: "helpful", contains_pii: false }),
      policies,
    );
    expect(result.verdict).toBe("PASS");
  });

  it("BLOCK: email.send with deceptive intent (hard enforcement)", () => {
    const result = checkPolicy(
      makeRequest("email.send", { intent: "deceptive", contains_pii: false }),
      policies,
    );
    expect(result.verdict).toBe("BLOCK");
    const blockCheck = result.rules_checked.find((c) => c.matched && c.verdict === "BLOCK");
    expect(blockCheck?.rule_id).toBe("policy.no_deception");
  });

  it("BLOCK: email.send with PII (hard enforcement)", () => {
    const result = checkPolicy(
      makeRequest("email.send", { intent: "helpful", contains_pii: true }),
      policies,
    );
    expect(result.verdict).toBe("BLOCK");
    const blockCheck = result.rules_checked.find((c) => c.rule_id === "policy.no_pii_export");
    expect(blockCheck?.verdict).toBe("BLOCK");
  });

  it("BLOCK: data.delete always requires human oversight", () => {
    const result = checkPolicy(makeRequest("data.delete"), policies);
    expect(result.verdict).toBe("BLOCK");
    const blockCheck = result.rules_checked.find((c) => c.rule_id === "policy.human_oversight");
    expect(blockCheck?.verdict).toBe("BLOCK");
  });

  it("BLOCK: contract.sign matches contract.* in policy", () => {
    const result = checkPolicy(makeRequest("contract.sign"), policies);
    expect(result.verdict).toBe("BLOCK");
  });

  it("WARN: web.fetch triggers soft log_external_access rule", () => {
    const result = checkPolicy(makeRequest("web.fetch"), policies);
    expect(result.verdict).toBe("WARN");
    const warnCheck = result.rules_checked.find((c) => c.matched && c.verdict === "WARN");
    expect(warnCheck?.rule_id).toBe("policy.log_external_access");
  });

  it("WARN: api.call triggers soft log_external_access rule", () => {
    const result = checkPolicy(makeRequest("api.call"), policies);
    expect(result.verdict).toBe("WARN");
  });

  it("short-circuits on first hard BLOCK (no remaining rules evaluated after block)", () => {
    // email.send with both deceptive intent AND pii — first hard rule blocks
    const result = checkPolicy(
      makeRequest("email.send", { intent: "deceptive", contains_pii: true }),
      policies,
    );
    expect(result.verdict).toBe("BLOCK");
    // Should stop at the first BLOCK rule (no_deception)
    const blockChecks = result.rules_checked.filter((c) => c.matched && c.verdict === "BLOCK");
    expect(blockChecks.length).toBe(1);
    expect(blockChecks[0]?.rule_id).toBe("policy.no_deception");
  });

  it("PASS: empty policies list", () => {
    const result = checkPolicy(makeRequest("contract.sign"), []);
    expect(result.verdict).toBe("PASS");
  });

  it("stage is 'policy'", () => {
    const result = checkPolicy(makeRequest("file.read"), policies);
    expect(result.stage).toBe("policy");
  });

  it("duration_ms is non-negative", () => {
    const result = checkPolicy(makeRequest("file.read"), policies);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
