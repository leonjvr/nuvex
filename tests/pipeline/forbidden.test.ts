/**
 * Tests for src/pipeline/forbidden.ts — Stage 1
 *
 * Checklist items covered:
 *   ✓ Forbidden action correctly blocked (exact match)
 *   ✓ Forbidden action with glob pattern ("data.*")
 *   ✓ Forbidden action with condition (amount > threshold)
 */

import { describe, it, expect } from "vitest";
import { checkForbidden } from "../../src/pipeline/forbidden.js";
import type { ActionRequest, ForbiddenRule } from "../../src/types/pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(type: string, overrides: Partial<ActionRequest["action"]> = {}): ActionRequest {
  return {
    request_id:    "req-001",
    timestamp:     "2026-02-27T00:00:00Z",
    agent_id:      "agent-1",
    agent_tier:    2,
    division_code: "engineering",
    action: {
      type,
      target:      "/file",
      description: "test",
      ...overrides,
    },
    context: { division_code: "engineering", session_id: "sess-001" },
  };
}

const rules: ForbiddenRule[] = [
  { action: "contract.sign", reason: "Contracts require human signature",     escalate_to: "CEO" },
  { action: "data.delete",   reason: "Audit trail is immutable",               escalate_to: "SYSTEM_BLOCK",
    condition: "target contains 'audit'" },
  { action: "purchase.*",    reason: "All purchases require human authorization", escalate_to: "CFO" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkForbidden — Stage 1", () => {
  it("PASS: action not in forbidden list", () => {
    const result = checkForbidden(makeRequest("email.send"), rules);
    expect(result.verdict).toBe("PASS");
    expect(result.stage).toBe("forbidden");
  });

  it("BLOCK: exact match (contract.sign)", () => {
    const result = checkForbidden(makeRequest("contract.sign"), rules);
    expect(result.verdict).toBe("BLOCK");
    const blockCheck = result.rules_checked.find((c) => c.matched);
    expect(blockCheck?.rule_id).toBe("forbidden.contract.sign");
    expect(blockCheck?.reason).toBe("Contracts require human signature");
  });

  it("BLOCK: glob match (purchase.initiate matches purchase.*)", () => {
    const result = checkForbidden(makeRequest("purchase.initiate"), rules);
    expect(result.verdict).toBe("BLOCK");
  });

  it("BLOCK: glob match (purchase.anything matches purchase.*)", () => {
    const result = checkForbidden(makeRequest("purchase.anything"), rules);
    expect(result.verdict).toBe("BLOCK");
  });

  it("PASS: data.delete with target not containing 'audit'", () => {
    const req = makeRequest("data.delete", { target: "/tmp/temp_data.csv" });
    const result = checkForbidden(req, rules);
    expect(result.verdict).toBe("PASS");
  });

  it("BLOCK: data.delete with target containing 'audit'", () => {
    const req = makeRequest("data.delete", { target: "/data/audit_trail.db" });
    const result = checkForbidden(req, rules);
    expect(result.verdict).toBe("BLOCK");
    const blockCheck = result.rules_checked.find((c) => c.matched);
    expect(blockCheck?.reason).toBe("Audit trail is immutable");
  });

  it("PASS: file.read is never forbidden", () => {
    const result = checkForbidden(makeRequest("file.read"), rules);
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked.every((c) => c.verdict === "PASS")).toBe(true);
  });

  it("PASS: empty rules list never blocks", () => {
    const result = checkForbidden(makeRequest("contract.sign"), []);
    expect(result.verdict).toBe("PASS");
  });

  it("result.stage is 'forbidden'", () => {
    const result = checkForbidden(makeRequest("email.send"), rules);
    expect(result.stage).toBe("forbidden");
  });

  it("duration_ms is a non-negative number", () => {
    const result = checkForbidden(makeRequest("email.send"), rules);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
