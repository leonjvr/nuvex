/**
 * Tests for src/pipeline/classification.ts — Stage 4
 *
 * Checklist items covered:
 *   ✓ Classification blocks T3 agent from CONFIDENTIAL data
 *   ✓ Classification allows T1 agent for SECRET data
 *   ✓ FYEO always blocks all agents
 *   ✓ Cross-division access auto-elevates to CONFIDENTIAL
 */

import { describe, it, expect } from "vitest";
import { checkClassification, resolveClassification, getRank } from "../../src/pipeline/classification.js";
import type { ActionRequest, ClassificationConfig } from "../../src/types/pipeline.js";
import { DEFAULT_CLASSIFICATION_LEVELS, DEFAULT_AGENT_CLEARANCE } from "../../src/pipeline/config-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<{
  agentTier:      1 | 2 | 3;
  divisionCode:   string;
  targetDivision: string;
  dataClass:      string;
  actionType:     string;
}> = {}): ActionRequest {
  return {
    request_id:    "req-001",
    timestamp:     "2026-02-27T00:00:00Z",
    agent_id:      "agent-1",
    agent_tier:    overrides.agentTier    ?? 2,
    division_code: overrides.divisionCode ?? "engineering",
    action: {
      type:                overrides.actionType ?? "file.read",
      target:              "/some/file",
      description:         "test",
      data_classification: overrides.dataClass as ActionRequest["action"]["data_classification"],
    },
    context: {
      division_code:   overrides.divisionCode   ?? "engineering",
      target_division: overrides.targetDivision,
      session_id:      "sess-001",
    },
  };
}

const defaultConfig: ClassificationConfig = {
  levels:          DEFAULT_CLASSIFICATION_LEVELS,
  agent_clearance: DEFAULT_AGENT_CLEARANCE,
  division_overrides: {
    legal: { tier_2: "SECRET" },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkClassification — Stage 4", () => {
  it("PASS: T2 agent accessing INTERNAL data", () => {
    const req = makeRequest({ agentTier: 2, dataClass: "INTERNAL" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("PASS");
  });

  it("PASS: T2 agent accessing CONFIDENTIAL data (max clearance)", () => {
    const req = makeRequest({ agentTier: 2, dataClass: "CONFIDENTIAL" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("PASS");
  });

  it("BLOCK: T2 agent accessing SECRET data (above clearance)", () => {
    const req = makeRequest({ agentTier: 2, dataClass: "SECRET" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("BLOCK");
    const blockCheck = result.rules_checked.find((c) => c.matched);
    expect(blockCheck?.rule_id).toBe("classification.insufficient_clearance");
    expect(blockCheck?.reason).toContain("SECRET");
  });

  it("BLOCK: T3 agent accessing CONFIDENTIAL data (above clearance)", () => {
    const req = makeRequest({ agentTier: 3, dataClass: "CONFIDENTIAL" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("BLOCK");
  });

  it("PASS: T3 agent accessing INTERNAL data (max clearance)", () => {
    const req = makeRequest({ agentTier: 3, dataClass: "INTERNAL" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("PASS");
  });

  it("PASS: T1 agent accessing SECRET data (clearance = SECRET)", () => {
    const req = makeRequest({ agentTier: 1, dataClass: "SECRET" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("PASS");
  });

  it("BLOCK: FYEO blocks T1 agent", () => {
    const req = makeRequest({ agentTier: 1, dataClass: "FYEO" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("BLOCK");
    const blockCheck = result.rules_checked.find((c) => c.matched);
    expect(blockCheck?.rule_id).toBe("classification.fyeo");
  });

  it("BLOCK: FYEO blocks T2 agent", () => {
    const req = makeRequest({ agentTier: 2, dataClass: "FYEO" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("BLOCK");
  });

  it("BLOCK: FYEO blocks T3 agent", () => {
    const req = makeRequest({ agentTier: 3, dataClass: "FYEO" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("BLOCK");
  });

  it("PASS: division override grants higher clearance (legal T2 = SECRET)", () => {
    const req = makeRequest({ agentTier: 2, divisionCode: "legal", dataClass: "SECRET" });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("PASS");
  });

  it("BLOCK: cross-division access auto-elevates to CONFIDENTIAL, blocks T3", () => {
    const req = makeRequest({
      agentTier:      3,
      divisionCode:   "engineering",
      targetDivision: "finance",
    });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("BLOCK");
  });

  it("PASS: cross-division access at CONFIDENTIAL, T2 agent passes", () => {
    const req = makeRequest({
      agentTier:      2,
      divisionCode:   "engineering",
      targetDivision: "finance",
    });
    const result = checkClassification(req, defaultConfig);
    expect(result.verdict).toBe("PASS");
  });

  it("result.stage is 'classification'", () => {
    const result = checkClassification(makeRequest(), defaultConfig);
    expect(result.stage).toBe("classification");
  });
});

describe("resolveClassification", () => {
  it("uses explicit data_classification when set", () => {
    const req = makeRequest({ dataClass: "SECRET" });
    expect(resolveClassification(req, defaultConfig)).toBe("SECRET");
  });

  it("uses CONFIDENTIAL for cross-division access (no explicit class)", () => {
    const req = makeRequest({ divisionCode: "engineering", targetDivision: "finance" });
    expect(resolveClassification(req, defaultConfig)).toBe("CONFIDENTIAL");
  });

  it("uses action type default from registry", () => {
    const req = makeRequest({ actionType: "email.send" });
    expect(resolveClassification(req, defaultConfig)).toBe("CONFIDENTIAL");
  });

  it("uses CONFIDENTIAL for unknown action type", () => {
    const req = makeRequest({ actionType: "something.weird.and.unknown" });
    expect(resolveClassification(req, defaultConfig)).toBe("CONFIDENTIAL");
  });
});

describe("getRank", () => {
  it("returns correct rank for known levels", () => {
    expect(getRank("PUBLIC",       DEFAULT_CLASSIFICATION_LEVELS)).toBe(0);
    expect(getRank("INTERNAL",     DEFAULT_CLASSIFICATION_LEVELS)).toBe(1);
    expect(getRank("CONFIDENTIAL", DEFAULT_CLASSIFICATION_LEVELS)).toBe(2);
    expect(getRank("SECRET",       DEFAULT_CLASSIFICATION_LEVELS)).toBe(3);
    expect(getRank("FYEO",         DEFAULT_CLASSIFICATION_LEVELS)).toBe(4);
  });

  it("returns 99 for unknown classification code", () => {
    expect(getRank("UNKNOWN_CODE", DEFAULT_CLASSIFICATION_LEVELS)).toBe(99);
  });
});
