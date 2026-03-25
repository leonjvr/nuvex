/**
 * Phase 13a: ToolResponseParser unit tests
 *
 * Tests the normalisation of raw ToolLLMResponse objects into the
 * AgentDecision discriminated union.
 */

import { describe, it, expect } from "vitest";
import { ToolResponseParser }   from "../../src/providers/tool-response-parser.js";
import type { ToolLLMResponse } from "../../src/providers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  toolCalls: ToolLLMResponse["toolCalls"],
  textContent = "",
): ToolLLMResponse {
  return {
    toolCalls,
    textContent,
    content:      textContent,
    usage:        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    latencyMs:    50,
    model:        "test-model",
    provider:     "test",
  };
}

const parser = new ToolResponseParser();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolResponseParser.parse", () => {
  it("parses execute_result tool call into AgentDecision", () => {
    const response = makeResponse([{
      name:  "execute_result",
      input: { result: "All tasks done.", summary: "Completed successfully.", confidence: 0.95 },
    }]);

    const decision = parser.parse(response);

    expect(decision.type).toBe("execute_result");
    if (decision.type !== "execute_result") throw new Error("type guard");
    expect(decision.result).toBe("All tasks done.");
    expect(decision.summary).toBe("Completed successfully.");
    expect(decision.confidence).toBe(0.95);
  });

  it("parses decompose_task tool call with sub_tasks array", () => {
    const response = makeResponse([{
      name:  "decompose_task",
      input: {
        reasoning: "Too broad for one agent",
        sub_tasks: [
          { title: "Sub A", description: "Handle part A", tier: 2 },
          { title: "Sub B", description: "Handle part B", tier: 2, division: "eng" },
        ],
      },
    }]);

    const decision = parser.parse(response);

    expect(decision.type).toBe("decompose_task");
    if (decision.type !== "decompose_task") throw new Error("type guard");
    expect(decision.reasoning).toBe("Too broad for one agent");
    expect(decision.sub_tasks).toHaveLength(2);
    expect(decision.sub_tasks[0]?.title).toBe("Sub A");
    expect(decision.sub_tasks[1]?.division).toBe("eng");
  });

  it("returns { type: 'no_tool_call' } when toolCalls is empty", () => {
    const response = makeResponse([]);
    const decision = parser.parse(response);
    expect(decision).toEqual({ type: "no_tool_call" });
  });

  it("returns first tool call when multiple are present", () => {
    const response = makeResponse([
      { name: "think_more",     input: { thoughts: "step one" } },
      { name: "execute_result", input: { result: "done", summary: "s", confidence: 1 } },
    ]);

    const decision = parser.parse(response);

    // First tool wins
    expect(decision.type).toBe("think_more");
    if (decision.type !== "think_more") throw new Error("type guard");
    expect(decision.thoughts).toBe("step one");
  });

  it("throws PROV-008 for an unknown tool name", () => {
    const response = makeResponse([{
      name:  "not_a_real_tool",
      input: { foo: "bar" },
    }]);

    expect(() => parser.parse(response)).toThrow();
    expect(() => parser.parse(response)).toThrowError(
      expect.objectContaining({ code: "PROV-008" }),
    );
  });
});

describe("ToolResponseParser.validate", () => {
  it("returns errors when execute_result is missing required fields", () => {
    // confidence out of range + missing summary
    const decision = { type: "execute_result" as const, result: "ok", summary: "", confidence: 1.5 };
    const result   = parser.validate(decision);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("summary"))).toBe(true);
    expect(result.errors.some((e) => e.includes("confidence"))).toBe(true);
  });
});
