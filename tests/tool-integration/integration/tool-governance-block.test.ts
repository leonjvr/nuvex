/**
 * Integration test: Tool Governance — Block
 *
 * Covers: a 'forbidden' rule with enforcement='block' prevents execution of
 * the matching capability.
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

describe("Tool Governance — Block Integration", () => {
  it("forbidden rule blocks action before execution", async () => {
    // 1. Register the tool so the FK constraint in tool_governance_rules is satisfied
    const registry = new ToolRegistry(db);
    registry.create({
      id: "gov-test-tool",
      name: "Gov Test Tool",
      type: "shell",
      config: { type: "shell" },
    });

    // 2. Create ToolGovernance
    const governance = new ToolGovernance(db);

    // 3. Add a forbidden rule for capability 'delete_all' with enforcement='block'
    governance.addRule({
      tool_id: "gov-test-tool",
      rule_type: "forbidden",
      pattern: "delete_all",
      enforcement: "block",
      active: true,
    });

    // 4. Create a rate limiter (no rate limits configured — empty config)
    const rateLimiter = new SlidingWindowRateLimiter();

    // 5. Check governance for the forbidden capability
    const result = await governance.check(
      "gov-test-tool",
      {
        tool_id: "gov-test-tool",
        capability: "delete_all",
        params: {},
        agent_id: "a1",
      },
      rateLimiter,
      {},
    );

    // 6. The action must be blocked
    expect(result.blocked).toBe(true);

    // 7. At least one check must have passed=false with rule_type='forbidden'
    const failedForbidden = result.checks.some(
      (c) => !c.passed && c.rule_type === "forbidden",
    );
    expect(failedForbidden).toBe(true);
  });
});
