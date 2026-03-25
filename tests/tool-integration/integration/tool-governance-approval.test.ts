/**
 * Integration test: Tool Governance — Approval Required
 *
 * Covers: an 'approval_required' rule with enforcement='approve' sets
 * requiresApproval=true without blocking the action.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../../src/tool-integration/migration.js";
import { ToolRegistry } from "../../../src/tool-integration/tool-registry.js";
import { ToolGovernance } from "../../../src/tool-integration/tool-governance.js";
import { SlidingWindowRateLimiter } from "../../../src/tool-integration/rate-limiter.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  runToolMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("Tool Governance — Approval Integration", () => {
  it("approval_required rule sets requiresApproval without blocking", async () => {
    // 1. Register the tool so the FK constraint is satisfied
    const registry = new ToolRegistry(db);
    registry.create({
      id: "approval-tool",
      name: "Approval Tool",
      type: "rest",
      config: { type: "rest", base_url: "https://example.com" },
    });

    // 2. Create ToolGovernance
    const governance = new ToolGovernance(db);

    // 3. Add an approval_required rule for capability 'send_email'
    governance.addRule({
      tool_id: "approval-tool",
      rule_type: "approval_required",
      pattern: "send_email",
      enforcement: "approve",
      active: true,
    });

    // 4. Create a rate limiter (no rate limit config needed for this test)
    const rateLimiter = new SlidingWindowRateLimiter();

    // 5. Check governance for the approval-required capability
    const result = await governance.check(
      "approval-tool",
      {
        tool_id: "approval-tool",
        capability: "send_email",
        params: {},
        agent_id: "a1",
      },
      rateLimiter,
      {},
    );

    // 6. The action must NOT be blocked
    expect(result.blocked).toBe(false);

    // 7. requiresApproval must be true
    expect(result.requiresApproval).toBe(true);
  });
});
