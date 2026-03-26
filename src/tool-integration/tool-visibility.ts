// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Tool Visibility Filtering (ARC-102)
 *
 * Determines which tools are VISIBLE to an agent based on tier, division,
 * and classification — before any tool description is generated or exposed.
 *
 * Security principle: unauthorised tools are invisible, not merely blocked.
 * An agent that cannot see a tool cannot prompt-inject against it.
 *
 * Rule #12 (fail-closed): the default return value of isToolVisibleForAgent
 * is `false`. A tool is only visible when every applicable constraint is met.
 */

import type { ToolAccess }     from "./types.js";
import type { ToolDescription } from "./types.js";


// ---------------------------------------------------------------------------
// Agent context
// ---------------------------------------------------------------------------

export interface AgentVisibilityContext {
  tier:            1 | 2 | 3;
  division:        string;
  /** Optional security classification of the agent (e.g. "internal", "confidential"). */
  classification?: string;
}


// ---------------------------------------------------------------------------
// Classification rank table
// ---------------------------------------------------------------------------

/** Numeric rank for classification labels — higher means more restricted. */
const CLASSIFICATION_RANK: Readonly<Record<string, number>> = {
  public:       0,
  internal:     1,
  confidential: 2,
  secret:       3,
  fyeo:         4,
};

function classificationRank(label: string | undefined): number {
  if (label === undefined) return 0;
  return CLASSIFICATION_RANK[label.toLowerCase()] ?? 0;
}


// ---------------------------------------------------------------------------
// isToolVisibleForAgent
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the tool should be visible (and described) to the agent.
 *
 * Checks (in order):
 *   1. Grant check  — tool must be in the agent's TOOL_GRANTS set.
 *   2. Access rules — if tool_access rows exist for this tool, at least one
 *      row must permit the agent's tier/division/classification combination.
 *      If no rows exist the tool is unrestricted beyond the grant check.
 *
 * Fail-closed (Rule #12): returns `false` on any unmet constraint.
 *
 * @param toolId     - Tool identifier (name or id from ToolDefinition / ToolDescription)
 * @param ctx        - Agent's tier, division, and optional classification
 * @param grantedIds - Set of tool ids/names granted via TOOL_GRANTS for this agent
 * @param accessRules - Per-tool constraints from the tool_access table (may be empty)
 */
export function isToolVisibleForAgent(
  toolId:      string,
  ctx:         AgentVisibilityContext,
  grantedIds:  ReadonlySet<string>,
  accessRules: ToolAccess[] = [],
): boolean {
  // 1. Grant check — fail-closed if the tool is not in the agent's granted set
  if (!grantedIds.has(toolId)) return false;

  // 2. Narrow to access rules that apply to this specific tool
  const rulesForTool = accessRules.filter((r) => r.tool_id === toolId);

  // No rules configured → no additional restrictions beyond the grant
  if (rulesForTool.length === 0) return true;

  // 3. At least ONE rule must permit. Any rule where all constraints pass grants access.
  for (const rule of rulesForTool) {
    // Tier constraint: tier_max means "visible to agents with tier number ≤ tier_max"
    // (lower tier number = higher authority — T1 > T2 > T3)
    if (rule.tier_max !== undefined && ctx.tier > rule.tier_max) continue;

    // Division constraint: restrict to a specific division
    if (rule.division_code !== undefined && rule.division_code !== ctx.division) continue;

    // Classification constraint: agent must meet or exceed the required clearance rank
    if (rule.classification_max !== undefined) {
      const agentRank = classificationRank(ctx.classification);
      const toolRank  = classificationRank(rule.classification_max);
      if (agentRank < toolRank) continue;
    }

    // All constraints in this rule are satisfied — tool is visible
    return true;
  }

  // No rule permitted access — fail-closed
  return false;
}


// ---------------------------------------------------------------------------
// getFilteredToolDescriptions
// ---------------------------------------------------------------------------

/**
 * Filter an array of ToolDescription objects to only those visible to the agent.
 *
 * Drop-in replacement for an unfiltered list wherever tool descriptions are
 * assembled for injection into an agent prompt.
 *
 * @param agentContext - Agent's tier, division, and optional classification
 * @param allTools     - Full list of candidate ToolDescription objects
 * @param grantedIds   - Tools granted via TOOL_GRANTS for this agent
 * @param accessRules  - Per-tool constraints (optional; may be empty)
 */
export function getFilteredToolDescriptions(
  agentContext: AgentVisibilityContext,
  allTools:     ToolDescription[],
  grantedIds:   ReadonlySet<string>,
  accessRules:  ToolAccess[] = [],
): ToolDescription[] {
  return allTools.filter((tool) =>
    isToolVisibleForAgent(tool.tool_id, agentContext, grantedIds, accessRules),
  );
}
