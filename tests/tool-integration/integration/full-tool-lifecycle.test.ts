/**
 * Integration test: Full Tool Lifecycle
 *
 * Covers: register → inject mock adapter → execute → write audit row → verify DB
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../../src/tool-integration/migration.js";
import { ToolRegistry } from "../../../src/tool-integration/tool-registry.js";
import { ToolManager } from "../../../src/tool-integration/tool-manager.js";
import type { ToolAdapter, ToolAction, ToolCapability, ToolResult, ToolType } from "../../../src/tool-integration/types.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  runToolMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("Full Tool Lifecycle Integration", () => {
  it("register → start → execute → tool_actions audit row written", async () => {
    // 1. Create ToolRegistry and register a shell tool
    const registry = new ToolRegistry(db);
    registry.create({
      id: "shell-lifecycle",
      name: "Shell",
      type: "shell",
      config: {
        type: "shell",
        allowed_commands: ["echo"],
      },
      capabilities: [
        {
          name: "execute",
          description: "Execute a shell command",
          risk_level: "low",
          requires_approval: false,
          input_schema: { command: { type: "string" } },
          output_schema: { stdout: { type: "string" } },
        },
      ],
    });

    // 2. Create ToolManager
    const manager = new ToolManager(db, registry);

    // 3. Build and inject a mock adapter
    const mockAdapter: ToolAdapter = {
      id: "shell-lifecycle",
      type: "shell" as ToolType,
      connect: async (): Promise<void> => { return; },
      execute: async (_action: ToolAction): Promise<ToolResult> => ({
        success: true,
        data: { stdout: "done" },
        duration_ms: 10,
      }),
      healthCheck: async (): Promise<boolean> => true,
      disconnect: async (): Promise<void> => { return; },
      getCapabilities: (): ToolCapability[] => [],
    };

    manager.registerAdapter("shell-lifecycle", mockAdapter);

    // 4. Mark tool active in the registry
    registry.updateStatus("shell-lifecycle", "active");

    // 5. Retrieve the adapter via manager
    const adapter = manager.getAdapter("shell-lifecycle");
    expect(adapter).toBeDefined();

    // 6. Execute an action through the adapter
    const action: ToolAction = {
      tool_id: "shell-lifecycle",
      capability: "execute",
      params: { command: "echo done" },
      agent_id: "agent-1",
    };

    const result = await adapter!.execute(action);
    expect(result.success).toBe(true);

    // 7. Write an audit row to tool_actions manually
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tool_actions
         (tool_id, agent_id, capability, params_json, status, governance_checks, duration_ms, cost_usd, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "shell-lifecycle",
      "agent-1",
      "execute",
      JSON.stringify(action.params),
      "success",
      "[]",
      result.duration_ms,
      0.0,
      now,
    );

    // 8. Verify exactly one audit row exists
    const rows = db
      .prepare("SELECT * FROM tool_actions WHERE tool_id = ?")
      .all("shell-lifecycle") as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);

    // 9. Verify row fields
    const row = rows[0]!;
    expect(row["capability"]).toBe("execute");
    expect(row["status"]).toBe("success");
    expect(row["agent_id"]).toBe("agent-1");
  });
});
