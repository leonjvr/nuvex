/**
 * Unit tests: ToolGovernance
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../src/tool-integration/migration.js";
import { ToolRegistry } from "../../src/tool-integration/tool-registry.js";
import { ToolGovernance } from "../../src/tool-integration/tool-governance.js";
import { SlidingWindowRateLimiter } from "../../src/tool-integration/rate-limiter.js";
import type { ToolAction } from "../../src/tool-integration/types.js";
import type { RateLimitConfig } from "../../src/tool-integration/rate-limiter.js";

type Db = ReturnType<typeof Database>;

function makeDb(): Db {
  const db = new Database(":memory:");
  runToolMigrations(db);
  return db;
}

const TEST_TOOL_ID = "gov-test-tool";

describe("ToolGovernance", () => {
  let db: Db;
  let registry: ToolRegistry;
  let governance: ToolGovernance;
  let rateLimiter: SlidingWindowRateLimiter;
  const defaultRateConfig: RateLimitConfig = {};

  beforeEach(() => {
    db = makeDb();
    registry = new ToolRegistry(db);
    registry.create({
      id: TEST_TOOL_ID,
      name: "Governance Test Tool",
      type: "shell",
      config: { type: "shell" },
    });
    governance = new ToolGovernance(db);
    rateLimiter = new SlidingWindowRateLimiter();
  });

  it("blocks action matching forbidden rule", async () => {
    governance.addRule({
      tool_id: TEST_TOOL_ID,
      rule_type: "forbidden",
      pattern: "dangerous_op",
      enforcement: "block",
      active: true,
    });

    const action: ToolAction = {
      tool_id: TEST_TOOL_ID,
      capability: "dangerous_op",
      params: {},
      agent_id: "a1",
    };

    const result = await governance.check(TEST_TOOL_ID, action, rateLimiter, defaultRateConfig);

    expect(result.blocked).toBe(true);
    expect(result.checks.length).toBe(1);
    expect(result.checks[0]!.passed).toBe(false);
    expect(result.checks[0]!.rule_type).toBe("forbidden");
  });

  it("blocks action matching path_restriction rule", async () => {
    governance.addRule({
      tool_id: TEST_TOOL_ID,
      rule_type: "path_restriction",
      pattern: "/etc",
      enforcement: "block",
      active: true,
    });

    const action: ToolAction = {
      tool_id: TEST_TOOL_ID,
      capability: "read_file",
      params: { path: "/etc/passwd" },
      agent_id: "a1",
    };

    const result = await governance.check(TEST_TOOL_ID, action, rateLimiter, defaultRateConfig);

    expect(result.blocked).toBe(true);
    expect(result.checks.length).toBe(1);
    expect(result.checks[0]!.passed).toBe(false);
    expect(result.checks[0]!.rule_type).toBe("path_restriction");
  });

  it("blocks when rate limit exceeded", async () => {
    const rateConfig: RateLimitConfig = { ops_per_min: 1 };

    governance.addRule({
      tool_id: TEST_TOOL_ID,
      rule_type: "rate_limit",
      enforcement: "block",
      active: true,
    });

    // Pre-fill the rate limiter so the limit is already reached
    rateLimiter.record(TEST_TOOL_ID, "execute", false, false, rateConfig);

    const action: ToolAction = {
      tool_id: TEST_TOOL_ID,
      capability: "execute",
      params: {},
      agent_id: "a1",
    };

    const result = await governance.check(TEST_TOOL_ID, action, rateLimiter, rateConfig);

    expect(result.blocked).toBe(true);
    const rateLimitCheck = result.checks.find((c) => c.rule_type === "rate_limit");
    expect(rateLimitCheck).toBeDefined();
    expect(rateLimitCheck!.passed).toBe(false);
  });

  it("sets requires_approval for approval_required rule", async () => {
    governance.addRule({
      tool_id: TEST_TOOL_ID,
      rule_type: "approval_required",
      pattern: "expensive_op",
      enforcement: "approve",
      active: true,
    });

    const action: ToolAction = {
      tool_id: TEST_TOOL_ID,
      capability: "expensive_op",
      params: {},
      agent_id: "a1",
    };

    const result = await governance.check(TEST_TOOL_ID, action, rateLimiter, defaultRateConfig);

    expect(result.blocked).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.checks.length).toBe(1);
    expect(result.checks[0]!.passed).toBe(true);
    expect(result.checks[0]!.requires_approval).toBe(true);
  });
});
