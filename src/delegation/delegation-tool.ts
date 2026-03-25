// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Delegation Bridge: LLM Tool Definitions
 *
 * Provides tool schema definitions for agent-callable delegation tools:
 *   - delegate_task          (T1, T2 only)
 *   - list_available_agents  (T1, T2, T3)
 *   - check_delegation_status (T1, T2 only)
 *
 * getDelegationToolsForTier(tier) returns only the tools that tier may use.
 */


export interface ToolParameter {
  type:        "string" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?:       string[];
  minimum?:    number;
  maximum?:    number;
}

export interface ToolDefinition {
  name:        string;
  description: string;
  parameters: {
    type:       "object";
    properties: Record<string, ToolParameter>;
    required:   string[];
  };
}


const DELEGATE_TASK: ToolDefinition = {
  name:        "delegate_task",
  description: "Delegate a subtask to a specialised worker agent. " +
    "The worker agent will execute the task independently and report results back. " +
    "Only use this when you have verified the target agent is available and appropriate.",
  parameters: {
    type: "object",
    properties: {
      target_agent_id: {
        type:        "string",
        description: "ID of the agent to delegate to. Use list_available_agents to find valid targets.",
      },
      description: {
        type:        "string",
        description: "Clear description of what the worker agent should do. Include all necessary context.",
      },
      priority: {
        type:        "number",
        description: "Task priority: 0=CRITICAL, 1=HIGH, 2=NORMAL, 3=LOW, 4=BACKGROUND.",
        minimum:     0,
        maximum:     4,
      },
      budget_usd: {
        type:        "number",
        description: "Cost budget in USD allocated from this task's budget (max 50% of remaining).",
        minimum:     0,
      },
      require_result: {
        type:        "boolean",
        description: "When true, wait for the subtask result before proceeding. When false, fire-and-forget.",
      },
      context: {
        type:        "string",
        description: "Optional additional context or instructions for the worker.",
      },
      deadline_at: {
        type:        "string",
        description: "Optional ISO 8601 deadline. Worker must complete before this time.",
      },
    },
    required: ["target_agent_id", "description", "priority", "budget_usd", "require_result"],
  },
};


const LIST_AVAILABLE_AGENTS: ToolDefinition = {
  name:        "list_available_agents",
  description: "List all active agents you can delegate tasks to. " +
    "Use this before delegate_task to find valid target agent IDs.",
  parameters: {
    type: "object",
    properties: {
      division: {
        type:        "string",
        description: "Optional filter: only return agents in this division (e.g. 'engineering', 'hr').",
      },
    },
    required: [],
  },
};


const CHECK_DELEGATION_STATUS: ToolDefinition = {
  name:        "check_delegation_status",
  description: "Check the status of a previously delegated subtask.",
  parameters: {
    type: "object",
    properties: {
      subtask_id: {
        type:        "string",
        description: "The subtask ID returned by delegate_task.",
      },
    },
    required: ["subtask_id"],
  },
};


/**
 * Return the delegation tool definitions available for the given agent tier.
 *
 * T1/T2 → all three tools (delegate + list + status)
 * T3    → list_available_agents only (read-only, cannot delegate)
 */
export function getDelegationToolsForTier(tier: 1 | 2 | 3): ToolDefinition[] {
  if (tier === 3) {
    return [LIST_AVAILABLE_AGENTS];
  }
  // T1 and T2
  return [DELEGATE_TASK, LIST_AVAILABLE_AGENTS, CHECK_DELEGATION_STATUS];
}

/**
 * Check whether a tool name is a delegation tool.
 */
export function isDelegationTool(toolName: string): boolean {
  return (
    toolName === "delegate_task" ||
    toolName === "list_available_agents" ||
    toolName === "check_delegation_status"
  );
}
