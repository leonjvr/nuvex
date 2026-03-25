// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13a: Tool Response Parser
 *
 * Normalises tool-call responses from ALL providers into the AgentDecision
 * discriminated union. Also exports AGENT_DECISION_TOOLS in both Anthropic
 * and OpenAI wire formats so each adapter can pick the right one.
 *
 * Parsing rules:
 *   - Anthropic: response.content[] → find block where type === "tool_use"
 *   - OpenAI:    response.choices[0].message.tool_calls[] → function.name + arguments
 *   - No tool call → { type: "no_tool_call" } (caller should retry)
 *   - Multiple tool calls → first wins, warning logged
 *   - Unknown tool name → ValidationResult.errors populated
 *   - Malformed arguments → ValidationResult.errors populated
 */

import { createLogger } from "../core/logger.js";
import { SidjuaError }  from "../core/error-codes.js";
import type {
  AgentDecision,
  AnthropicTool,
  OpenAITool,
  ToolDefinition,
  ToolLLMResponse,
  ValidationResult,
} from "./types.js";

const logger = createLogger("providers");


/** Tool definitions in provider-agnostic format. */
export const AGENT_DECISION_TOOLS: ToolDefinition[] = [
  {
    name:        "execute_result",
    description: "Signal that the task is complete. Provide the full result text, a management summary, and a confidence score.",
    parameters: {
      type: "object",
      properties: {
        result:     { type: "string", description: "Full result text or file content" },
        summary:    { type: "string", description: "2-5 sentence management summary" },
        confidence: { type: "number", description: "Self-assessed confidence 0.0-1.0" },
      },
      required: ["result", "summary", "confidence"],
    },
  },
  {
    name:        "decompose_task",
    description: "Decompose the task into parallel or sequential sub-tasks for lower-tier agents.",
    parameters: {
      type: "object",
      properties: {
        reasoning:  { type: "string", description: "Why decomposition is needed" },
        sub_tasks:  { type: "array",  description: "List of sub-task definitions" },
      },
      required: ["reasoning", "sub_tasks"],
    },
  },
  {
    name:        "request_consultation",
    description: "Request a peer consultation from a specialized agent.",
    parameters: {
      type: "object",
      properties: {
        question:           { type: "string", description: "Specific question to ask" },
        target_capability:  { type: "string", description: "Required capability of the consulted agent" },
        context:            { type: "string", description: "Relevant context for the consultant" },
      },
      required: ["question", "target_capability"],
    },
  },
  {
    name:        "escalate_task",
    description: "Escalate the task to a higher-tier agent because it exceeds current capabilities.",
    parameters: {
      type: "object",
      properties: {
        reason:     { type: "string", description: "Why escalation is needed" },
        attempted:  { type: "string", description: "What was attempted before escalating" },
        suggestion: { type: "string", description: "Suggested approach for higher tier" },
      },
      required: ["reason", "attempted"],
    },
  },
  {
    name:        "use_tool",
    description: "Request execution of an external tool (filesystem, shell, API, browser).",
    parameters: {
      type: "object",
      properties: {
        tool_name:  { type: "string", description: "Name of the tool to invoke" },
        tool_input: { type: "object", description: "Tool-specific input parameters" },
        purpose:    { type: "string", description: "Why this tool is needed" },
      },
      required: ["tool_name", "tool_input", "purpose"],
    },
  },
  {
    name:        "think_more",
    description: "Take more reasoning steps before deciding. Use when the problem requires deeper analysis.",
    parameters: {
      type: "object",
      properties: {
        thoughts:  { type: "string", description: "Current chain of thought" },
        next_step: { type: "string", description: "What to investigate next" },
      },
      required: ["thoughts"],
    },
  },
];

const VALID_TOOL_NAMES = new Set(AGENT_DECISION_TOOLS.map((t) => t.name));

/** AGENT_DECISION_TOOLS in Anthropic wire format. */
export const ANTHROPIC_TOOLS: AnthropicTool[] = AGENT_DECISION_TOOLS.map((t) => ({
  name:         t.name,
  description:  t.description,
  input_schema: t.parameters,
}));

/** AGENT_DECISION_TOOLS in OpenAI wire format. */
export const OPENAI_TOOLS: OpenAITool[] = AGENT_DECISION_TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name:        t.name,
    description: t.description,
    parameters:  t.parameters,
  },
}));


export class ToolResponseParser {
  /**
   * Parse a ToolLLMResponse into an AgentDecision.
   *
   * @throws SidjuaError(PROV-008) when the tool input cannot be coerced
   *         into a valid decision structure.
   */
  parse(response: ToolLLMResponse): AgentDecision {
    if (response.toolCalls.length === 0) {
      return { type: "no_tool_call" };
    }

    if (response.toolCalls.length > 1) {
      logger.warn("tool_response_multiple_calls", "LLM returned multiple tool calls — using first", {
        metadata: {
          toolCount:  response.toolCalls.length,
          toolNames:  response.toolCalls.map((tc) => tc.name),
        },
      });
    }

    const call = response.toolCalls[0]!;

    // Build decision from first tool call
    try {
      return buildDecision(call.name, call.input);
    } catch (err) {
      throw SidjuaError.from(
        "PROV-008",
        `Failed to build AgentDecision from tool "${call.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Validate an AgentDecision — check tool name and required fields. */
  validate(decision: AgentDecision): ValidationResult {
    if (decision.type === "no_tool_call") {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];

    if (!VALID_TOOL_NAMES.has(decision.type)) {
      errors.push(`Unknown decision type: ${decision.type}`);
      return { valid: false, errors };
    }

    // Type-specific validation
    switch (decision.type) {
      case "execute_result":
        if (!decision.result)  errors.push("execute_result.result is required");
        if (!decision.summary) errors.push("execute_result.summary is required");
        if (typeof decision.confidence !== "number" ||
            decision.confidence < 0 || decision.confidence > 1) {
          errors.push("execute_result.confidence must be a number 0.0-1.0");
        }
        break;
      case "decompose_task":
        if (!decision.reasoning)       errors.push("decompose_task.reasoning is required");
        if (!Array.isArray(decision.sub_tasks) || decision.sub_tasks.length === 0) {
          errors.push("decompose_task.sub_tasks must be a non-empty array");
        }
        break;
      case "request_consultation":
        if (!decision.question)          errors.push("request_consultation.question is required");
        if (!decision.target_capability) errors.push("request_consultation.target_capability is required");
        break;
      case "escalate_task":
        if (!decision.reason)    errors.push("escalate_task.reason is required");
        if (!decision.attempted) errors.push("escalate_task.attempted is required");
        break;
      case "use_tool":
        if (!decision.tool_name)  errors.push("use_tool.tool_name is required");
        if (!decision.tool_input) errors.push("use_tool.tool_input is required");
        if (!decision.purpose)    errors.push("use_tool.purpose is required");
        break;
      case "think_more":
        if (!decision.thoughts) errors.push("think_more.thoughts is required");
        break;
    }

    return { valid: errors.length === 0, errors };
  }
}


function buildDecision(toolName: string, input: Record<string, unknown>): AgentDecision {
  switch (toolName) {
    case "execute_result":
      return {
        type:       "execute_result",
        result:     String(input["result"] ?? ""),
        summary:    String(input["summary"] ?? ""),
        confidence: Number(input["confidence"] ?? 0),
      };

    case "decompose_task":
      return {
        type:      "decompose_task",
        reasoning: String(input["reasoning"] ?? ""),
        sub_tasks: Array.isArray(input["sub_tasks"])
          ? (input["sub_tasks"] as SubTaskRaw[]).map(normalizeSubTask)
          : [],
      };

    case "request_consultation":
      return {
        type:               "request_consultation",
        question:           String(input["question"] ?? ""),
        target_capability:  String(input["target_capability"] ?? ""),
        ...(input["context"] !== undefined ? { context: String(input["context"]) } : {}),
      };

    case "escalate_task":
      return {
        type:      "escalate_task",
        reason:    String(input["reason"] ?? ""),
        attempted: String(input["attempted"] ?? ""),
        ...(input["suggestion"] !== undefined ? { suggestion: String(input["suggestion"]) } : {}),
      };

    case "use_tool":
      return {
        type:       "use_tool",
        tool_name:  String(input["tool_name"] ?? ""),
        tool_input: (input["tool_input"] as Record<string, unknown>) ?? {},
        purpose:    String(input["purpose"] ?? ""),
      };

    case "think_more":
      return {
        type:     "think_more",
        thoughts: String(input["thoughts"] ?? ""),
        ...(input["next_step"] !== undefined ? { next_step: String(input["next_step"]) } : {}),
      };

    default:
      throw new Error(`Unknown tool name: ${toolName}`);
  }
}

interface SubTaskRaw {
  title?:       unknown;
  description?: unknown;
  tier?:        unknown;
  division?:    unknown;
}

function normalizeSubTask(raw: SubTaskRaw) {
  const tier = Number(raw.tier ?? 2);
  return {
    title:       String(raw.title ?? ""),
    description: String(raw.description ?? ""),
    tier:        ([1, 2, 3].includes(tier) ? tier : 2) as 1 | 2 | 3,
    ...(raw.division !== undefined ? { division: String(raw.division) } : {}),
  };
}
