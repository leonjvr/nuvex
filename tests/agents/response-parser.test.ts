/**
 * Tests for src/agents/response-parser.ts
 */

import { describe, it, expect } from "vitest";
import { parseAgentResponse } from "../../src/agents/response-parser.js";

// ---------------------------------------------------------------------------
// EXECUTE responses
// ---------------------------------------------------------------------------

describe("parseAgentResponse — EXECUTE", () => {
  it("parses a well-formed EXECUTE response", () => {
    const text = `DECISION: EXECUTE

RESULT:
The authentication middleware was implemented using JWT tokens.

SUMMARY:
I implemented JWT auth middleware. It verifies tokens on every request. Tests are included.

CONFIDENCE: 0.92`;

    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("EXECUTE");
    if (result!.decision !== "EXECUTE") return;
    expect(result.result).toContain("JWT tokens");
    expect(result.summary).toContain("JWT auth middleware");
    expect(result.confidence).toBeCloseTo(0.92);
  });

  it("handles case-insensitive DECISION header", () => {
    const text = `decision: execute

RESULT:
Done.

SUMMARY:
Task completed.

CONFIDENCE: 0.8`;
    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("EXECUTE");
  });

  it("defaults confidence to 0.8 when missing", () => {
    const text = `DECISION: EXECUTE

RESULT:
Done.

SUMMARY:
Summary here.
`;
    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    if (result!.decision !== "EXECUTE") return;
    expect(result.confidence).toBe(0.8);
  });

  it("clamps confidence > 1.0 to 1.0", () => {
    const text = `DECISION: EXECUTE

RESULT:
Done.

SUMMARY:
Summary.

CONFIDENCE: 1.5`;
    const result = parseAgentResponse(text);
    if (result!.decision !== "EXECUTE") return;
    expect(result.confidence).toBe(1.0);
  });

  it("returns default 0.8 for negative confidence (regex does not match negatives)", () => {
    // The parser regex \d+(?:\.\d+)? doesn't match negative numbers.
    // When unmatched, the default 0.8 is used.
    const text = `DECISION: EXECUTE

RESULT:
Done.

SUMMARY:
Summary.

CONFIDENCE: -0.5`;
    const result = parseAgentResponse(text);
    if (result!.decision !== "EXECUTE") return;
    expect(result.confidence).toBe(0.8); // default because -0.5 doesn't match
  });

  it("returns null when SUMMARY missing", () => {
    const text = `DECISION: EXECUTE

RESULT:
Done.

CONFIDENCE: 0.9`;
    const result = parseAgentResponse(text);
    expect(result).toBeNull();
  });

  it("allows empty RESULT section", () => {
    const text = `DECISION: EXECUTE

RESULT:

SUMMARY:
Summary here.

CONFIDENCE: 0.7`;
    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    if (result!.decision !== "EXECUTE") return;
    expect(result.result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DECOMPOSE responses
// ---------------------------------------------------------------------------

describe("parseAgentResponse — DECOMPOSE", () => {
  it("parses a well-formed DECOMPOSE response with em-dash", () => {
    const text = `DECISION: DECOMPOSE

PLAN:
- Set up auth routes — Create POST /login and POST /logout endpoints — [tier: 3]
- Implement JWT signing — Write token generation and validation helpers — [tier: 3]
- Add middleware — Attach auth middleware to protected routes — [tier: 2]
`;

    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("DECOMPOSE");
    if (result!.decision !== "DECOMPOSE") return;
    expect(result.plan).toHaveLength(3);
    expect(result.plan[0]!.title).toContain("auth routes");
    expect(result.plan[0]!.tier).toBe(3);
    expect(result.plan[2]!.tier).toBe(2);
  });

  it("parses DECOMPOSE with double-dash separator", () => {
    const text = `DECISION: DECOMPOSE

PLAN:
- Setup database -- Create SQLite schema -- [tier: 3]
- Write migrations -- Apply schema changes -- [tier: 3]
`;

    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    if (result!.decision !== "DECOMPOSE") return;
    expect(result.plan).toHaveLength(2);
    expect(result.plan[0]!.title).toContain("database");
  });

  it("defaults tier to 3 when not specified", () => {
    const text = `DECISION: DECOMPOSE

PLAN:
- Task one — Do something important
- Task two — Do another thing
`;

    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    if (result!.decision !== "DECOMPOSE") return;
    expect(result.plan.every((p) => p.tier === 3)).toBe(true);
  });

  it("returns null when PLAN section missing", () => {
    const text = `DECISION: DECOMPOSE

No plan section here.
`;
    const result = parseAgentResponse(text);
    expect(result).toBeNull();
  });

  it("returns null when PLAN has no valid subtask lines", () => {
    const text = `DECISION: DECOMPOSE

PLAN:
This is not a list.
Just some random text.
`;
    const result = parseAgentResponse(text);
    expect(result).toBeNull();
  });

  it("parses numbered list items", () => {
    const text = `DECISION: DECOMPOSE

PLAN:
1. Write tests — Implement unit tests for auth — [tier: 3]
2. Write docs — Document the auth API — [tier: 3]
`;

    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    if (result!.decision !== "DECOMPOSE") return;
    expect(result.plan).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Error / edge cases
// ---------------------------------------------------------------------------

describe("parseAgentResponse — edge cases", () => {
  it("returns null for empty string", () => {
    expect(parseAgentResponse("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseAgentResponse("   \n   ")).toBeNull();
  });

  it("returns null when DECISION missing", () => {
    const text = `RESULT:
Done.

SUMMARY:
Summary.`;
    expect(parseAgentResponse(text)).toBeNull();
  });

  it("returns null for invalid DECISION value", () => {
    const text = `DECISION: UNKNOWN

RESULT:
Done.`;
    expect(parseAgentResponse(text)).toBeNull();
  });

  it("handles DECISION with extra whitespace", () => {
    const text = `DECISION :  EXECUTE

RESULT:
Done.

SUMMARY:
Summary.

CONFIDENCE: 0.9`;
    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("EXECUTE");
  });

  it("parses multi-line RESULT content", () => {
    const text = `DECISION: EXECUTE

RESULT:
Line one of result.
Line two of result.
Line three.

SUMMARY:
Done well.

CONFIDENCE: 0.88`;

    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    if (result!.decision !== "EXECUTE") return;
    expect(result.result).toContain("Line one");
    expect(result.result).toContain("Line three");
  });

  it("parses response with text before DECISION", () => {
    const text = `I have analyzed the task carefully.

DECISION: EXECUTE

RESULT:
Analysis complete.

SUMMARY:
I did it.

CONFIDENCE: 0.75`;

    const result = parseAgentResponse(text);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("EXECUTE");
  });
});
