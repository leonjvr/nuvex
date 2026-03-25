// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * DelegationTool — unit tests
 *
 * Test cases:
 *   1. T1 gets all three delegation tools
 *   2. T2 gets all three delegation tools
 *   3. T3 gets only list_available_agents
 *   4. isDelegationTool correctly identifies tool names
 */

import { describe, it, expect } from "vitest";
import {
  getDelegationToolsForTier,
  isDelegationTool,
} from "../../src/delegation/delegation-tool.js";

describe("getDelegationToolsForTier", () => {
  it("T1 agent gets all three delegation tools", () => {
    const tools = getDelegationToolsForTier(1);
    const names  = tools.map((t) => t.name);

    expect(names).toContain("delegate_task");
    expect(names).toContain("list_available_agents");
    expect(names).toContain("check_delegation_status");
    expect(tools).toHaveLength(3);
  });

  it("T2 agent gets all three delegation tools", () => {
    const tools = getDelegationToolsForTier(2);
    const names  = tools.map((t) => t.name);

    expect(names).toContain("delegate_task");
    expect(names).toContain("list_available_agents");
    expect(names).toContain("check_delegation_status");
    expect(tools).toHaveLength(3);
  });

  it("T3 agent gets only list_available_agents", () => {
    const tools = getDelegationToolsForTier(3);
    const names  = tools.map((t) => t.name);

    expect(names).toContain("list_available_agents");
    expect(names).not.toContain("delegate_task");
    expect(names).not.toContain("check_delegation_status");
    expect(tools).toHaveLength(1);
  });

  it("delegate_task tool has required parameters: target_agent_id, description, priority, budget_usd, require_result", () => {
    const tools      = getDelegationToolsForTier(1);
    const delegateTool = tools.find((t) => t.name === "delegate_task");

    expect(delegateTool).toBeDefined();
    expect(delegateTool!.parameters.required).toContain("target_agent_id");
    expect(delegateTool!.parameters.required).toContain("description");
    expect(delegateTool!.parameters.required).toContain("priority");
    expect(delegateTool!.parameters.required).toContain("budget_usd");
    expect(delegateTool!.parameters.required).toContain("require_result");
  });

  it("check_delegation_status tool has required parameter: subtask_id", () => {
    const tools  = getDelegationToolsForTier(1);
    const statusTool = tools.find((t) => t.name === "check_delegation_status");

    expect(statusTool).toBeDefined();
    expect(statusTool!.parameters.required).toContain("subtask_id");
  });
});

describe("isDelegationTool", () => {
  it("returns true for delegation tool names", () => {
    expect(isDelegationTool("delegate_task")).toBe(true);
    expect(isDelegationTool("list_available_agents")).toBe(true);
    expect(isDelegationTool("check_delegation_status")).toBe(true);
  });

  it("returns false for non-delegation tool names", () => {
    expect(isDelegationTool("bash")).toBe(false);
    expect(isDelegationTool("read_file")).toBe(false);
    expect(isDelegationTool("")).toBe(false);
    expect(isDelegationTool("DELEGATE_TASK")).toBe(false); // case-sensitive
  });
});
