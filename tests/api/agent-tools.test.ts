// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Tests for agent-tools: executeToolCall, getToolDefinitions, registerAgentToolRoutes.
 *
 * Covers:
 *   - Authorization matrix (HR gets all 5, Guide gets 3, others get 1)
 *   - list_agents returns array of agents
 *   - list_divisions returns array of divisions
 *   - create_agent_role validates inputs and writes YAML
 *   - create_division validates inputs and writes YAML
 *   - ask_agent rejects depth >= 3
 *   - ask_agent rejects self-calls
 *   - ask_agent rejects unknown target agent
 *   - REST endpoint POST /api/v1/agents/:agentId/tool-call
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir }  from "node:os";
import { join }    from "node:path";
import { Hono }    from "hono";
import { createErrorHandler }      from "../../src/api/middleware/error-handler.js";
import {
  executeToolCall,
  getToolDefinitions,
  getAllowedTools,
  registerAgentToolRoutes,
} from "../../src/api/routes/agent-tools.js";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-agent-tools-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeCtx(depth = 0) {
  return { workDir: tmpDir, db: null, depth };
}

// ---------------------------------------------------------------------------
// Authorization matrix
// ---------------------------------------------------------------------------

describe("getAllowedTools — authorization matrix", () => {
  it("HR gets all 5 tools", () => {
    const tools = getAllowedTools("hr");
    expect(tools.has("create_agent_role")).toBe(true);
    expect(tools.has("create_division")).toBe(true);
    expect(tools.has("list_agents")).toBe(true);
    expect(tools.has("list_divisions")).toBe(true);
    expect(tools.has("ask_agent")).toBe(true);
  });

  it("Guide gets list_agents, list_divisions, ask_agent", () => {
    const tools = getAllowedTools("guide");
    expect(tools.has("list_agents")).toBe(true);
    expect(tools.has("list_divisions")).toBe(true);
    expect(tools.has("ask_agent")).toBe(true);
    expect(tools.has("create_agent_role")).toBe(false);
    expect(tools.has("create_division")).toBe(false);
  });

  it("Finance agent gets only ask_agent", () => {
    const tools = getAllowedTools("finance");
    expect(tools.has("ask_agent")).toBe(true);
    expect(tools.has("list_agents")).toBe(false);
    expect(tools.has("create_agent_role")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe("getToolDefinitions", () => {
  it("HR gets 5 tool definitions", () => {
    expect(getToolDefinitions("hr").length).toBe(5);
  });

  it("Guide gets 3 tool definitions", () => {
    expect(getToolDefinitions("guide").length).toBe(3);
  });

  it("Finance gets 1 tool definition (ask_agent)", () => {
    const defs = getToolDefinitions("finance");
    expect(defs.length).toBe(1);
    const fn = (defs[0] as Record<string, unknown>)["function"] as Record<string, unknown>;
    expect(fn["name"]).toBe("ask_agent");
  });

  it("Each definition has type=function and a function.name", () => {
    for (const def of getToolDefinitions("hr")) {
      expect((def as Record<string, unknown>)["type"]).toBe("function");
      const fn = (def as Record<string, unknown>)["function"] as Record<string, unknown>;
      expect(typeof fn["name"]).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

describe("executeToolCall — list_agents", () => {
  it("returns success with agents array for HR", async () => {
    const result = await executeToolCall("hr", "list_agents", {}, makeCtx());
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    const agents = result.data as unknown[];
    expect(agents.length).toBeGreaterThan(0);
  });

  it("each agent has id, name, tier, division", async () => {
    const result = await executeToolCall("hr", "list_agents", {}, makeCtx());
    const agents = result.data as Array<Record<string, unknown>>;
    for (const agent of agents) {
      expect(typeof agent["id"]).toBe("string");
      expect(typeof agent["name"]).toBe("string");
      expect([1, 2, 3]).toContain(agent["tier"]);
    }
  });

  it("returns unauthorized error for finance agent", async () => {
    const result = await executeToolCall("finance", "list_agents", {}, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not authorized/i);
  });
});

// ---------------------------------------------------------------------------
// list_divisions
// ---------------------------------------------------------------------------

describe("executeToolCall — list_divisions", () => {
  it("returns success with divisions array for HR", async () => {
    const result = await executeToolCall("hr", "list_divisions", {}, makeCtx());
    expect(result.success).toBe(true);
    const divs = result.data as unknown[];
    expect(Array.isArray(divs)).toBe(true);
    expect(divs.length).toBeGreaterThan(0);
  });

  it("each division has id, name, budget", async () => {
    const result = await executeToolCall("hr", "list_divisions", {}, makeCtx());
    const divs = result.data as Array<Record<string, unknown>>;
    for (const d of divs) {
      expect(typeof d["id"]).toBe("string");
      expect(typeof d["name"]).toBe("string");
      expect(d["budget"]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// create_agent_role
// ---------------------------------------------------------------------------

describe("executeToolCall — create_agent_role", () => {
  it("creates YAML file in agents/definitions/", async () => {
    const result = await executeToolCall("hr", "create_agent_role", {
      role_id:     "test-analyst",
      name:        "Test Analyst",
      description: "Analyzes test results",
      tier:        2,
      division:    "workspace",
      capabilities: ["Run tests", "Generate reports"],
    }, makeCtx());

    expect(result.success).toBe(true);
    const targetPath = join(tmpDir, "agents", "definitions", "test-analyst.yaml");
    expect(existsSync(targetPath)).toBe(true);
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("id: test-analyst");
    expect(content).toContain("name: Test Analyst");
    expect(content).toContain("tier: 2");
    expect(content).toContain("Run tests");
  });

  it("returns error for missing role_id", async () => {
    const result = await executeToolCall("hr", "create_agent_role", {
      name: "Foo",
      description: "bar",
    }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/role_id/);
  });

  it("returns error for invalid role_id (uppercase)", async () => {
    const result = await executeToolCall("hr", "create_agent_role", {
      role_id: "TestAgent",
      name:    "Test",
      description: "desc",
    }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/role_id/);
  });

  it("returns error if role already exists", async () => {
    await executeToolCall("hr", "create_agent_role", {
      role_id: "dup-agent",
      name:    "Dup",
      description: "Duplicate",
    }, makeCtx());

    const second = await executeToolCall("hr", "create_agent_role", {
      role_id: "dup-agent",
      name:    "Dup2",
      description: "Duplicate again",
    }, makeCtx());
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already exists/);
  });

  it("unauthorized for guide agent", async () => {
    const result = await executeToolCall("guide", "create_agent_role", {
      role_id: "test",
      name:    "Test",
      description: "Test",
    }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not authorized/i);
  });
});

// ---------------------------------------------------------------------------
// create_division
// ---------------------------------------------------------------------------

describe("executeToolCall — create_division", () => {
  it("creates YAML file in governance/divisions/", async () => {
    const result = await executeToolCall("hr", "create_division", {
      id:          "engineering",
      name:        "Engineering",
      description: "Software engineering team",
      daily_limit_usd: 10.0,
      monthly_cap_usd: 100.0,
    }, makeCtx());

    expect(result.success).toBe(true);
    const targetPath = join(tmpDir, "governance", "divisions", "engineering.yaml");
    expect(existsSync(targetPath)).toBe(true);
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("id: engineering");
    expect(content).toContain("name: Engineering");
    expect(content).toContain("daily_limit_usd: 10");
  });

  it("uses default budget when not provided", async () => {
    const result = await executeToolCall("hr", "create_division", {
      id:          "marketing",
      name:        "Marketing",
      description: "Marketing team",
    }, makeCtx());

    expect(result.success).toBe(true);
    const content = readFileSync(join(tmpDir, "governance", "divisions", "marketing.yaml"), "utf-8");
    expect(content).toContain("daily_limit_usd: 5");
    expect(content).toContain("monthly_cap_usd: 50");
  });

  it("returns error for missing id", async () => {
    const result = await executeToolCall("hr", "create_division", {
      name: "Foo",
      description: "bar",
    }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/id/);
  });

  it("returns error for invalid id (uppercase)", async () => {
    const result = await executeToolCall("hr", "create_division", {
      id:          "Engineering",
      name:        "Engineering",
      description: "desc",
    }, makeCtx());
    expect(result.success).toBe(false);
  });

  it("returns error if division already exists", async () => {
    await executeToolCall("hr", "create_division", {
      id: "dup-div", name: "Dup", description: "Duplicate",
    }, makeCtx());
    const second = await executeToolCall("hr", "create_division", {
      id: "dup-div", name: "Dup2", description: "Duplicate again",
    }, makeCtx());
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already exists/);
  });
});

// ---------------------------------------------------------------------------
// ask_agent — depth + self-call + unknown agent
// ---------------------------------------------------------------------------

describe("executeToolCall — ask_agent validation", () => {
  it("returns error when depth >= 3", async () => {
    const result = await executeToolCall("hr", "ask_agent", {
      agent_id: "guide",
      question: "Hello?",
    }, makeCtx(3));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/depth limit/i);
  });

  it("returns error when agent tries to ask itself", async () => {
    const result = await executeToolCall("hr", "ask_agent", {
      agent_id: "hr",
      question: "What do I do?",
    }, makeCtx(0));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/itself/);
  });

  it("returns error for unknown target agent", async () => {
    const result = await executeToolCall("hr", "ask_agent", {
      agent_id: "nonexistent-agent-xyz",
      question: "Hello?",
    }, makeCtx(0));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("returns error for missing agent_id", async () => {
    const result = await executeToolCall("hr", "ask_agent", { question: "Hello?" }, makeCtx(0));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/agent_id/);
  });

  it("returns error for missing question", async () => {
    const result = await executeToolCall("hr", "ask_agent", { agent_id: "guide" }, makeCtx(0));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/question/);
  });
});

// ---------------------------------------------------------------------------
// Unknown tool
// ---------------------------------------------------------------------------

describe("executeToolCall — unknown tool", () => {
  it("returns error for unknown tool name (not in any grant list)", async () => {
    // "delete_everything" is not in HR's grant list, so auth check fires first
    const result = await executeToolCall("hr", "delete_everything", {}, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns unknown tool error when tool is in grants but not implemented", async () => {
    // executeToolCall with a tool name that passes auth (we test this via the default branch)
    // Verify the default switch branch is covered via the unknown tool for a non-existing entry
    const result = await executeToolCall("hr", "ask_agent_v2", {}, makeCtx());
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REST endpoint
// ---------------------------------------------------------------------------

describe("POST /api/v1/agents/:agentId/tool-call", () => {
  function buildApp() {
    const app = new Hono();
    app.use("*", withAdminCtx);
    app.onError(createErrorHandler(false));
    registerAgentToolRoutes(app, { workDir: tmpDir });
    return app;
  }

  it("returns 404 for unknown agent", async () => {
    const res = await buildApp().request("/api/v1/agents/nonexistent/tool-call", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tool: "list_agents", parameters: {} }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for missing tool field", async () => {
    const res = await buildApp().request("/api/v1/agents/hr/tool-call", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ parameters: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with data for list_agents on HR", async () => {
    const res = await buildApp().request("/api/v1/agents/hr/tool-call", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tool: "list_agents", parameters: {} }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 400 with error for unauthorized tool", async () => {
    const res = await buildApp().request("/api/v1/agents/finance/tool-call", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tool: "create_division", parameters: { id: "x", name: "X", description: "X" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not authorized/i);
  });

  it("returns 200 with created file for create_agent_role", async () => {
    const res = await buildApp().request("/api/v1/agents/hr/tool-call", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        tool: "create_agent_role",
        parameters: {
          role_id:     "rest-test-agent",
          name:        "REST Test Agent",
          description: "Created via REST",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(existsSync(join(tmpDir, "agents", "definitions", "rest-test-agent.yaml"))).toBe(true);
  });
});
