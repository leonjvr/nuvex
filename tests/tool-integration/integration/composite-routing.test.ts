/**
 * Integration test: Composite Adapter Routing
 *
 * Covers: fallback strategy — when the preferred sub-tool throws, the composite
 * adapter logs the failure and executes the secondary sub-tool instead.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../../src/tool-integration/migration.js";
import { CompositeAdapter } from "../../../src/tool-integration/adapters/composite-adapter.js";
import type {
  ToolAdapter,
  ToolAction,
  ToolCapability,
  ToolResult,
  ToolType,
} from "../../../src/tool-integration/types.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  runToolMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("Composite Adapter Routing Integration", () => {
  it("preferred sub-tool fails → fallback logs → secondary executes", async () => {
    // 1. Create two mock adapters
    const primaryAdapter: ToolAdapter = {
      id: "primary-tool",
      type: "shell" as ToolType,
      connect: async (): Promise<void> => { return; },
      execute: async (_action: ToolAction): Promise<ToolResult> => {
        throw new Error("primary failed");
      },
      healthCheck: async (): Promise<boolean> => false,
      disconnect: async (): Promise<void> => { return; },
      getCapabilities: (): ToolCapability[] => [],
    };

    const secondaryAdapter: ToolAdapter = {
      id: "secondary-tool",
      type: "shell" as ToolType,
      connect: async (): Promise<void> => { return; },
      execute: async (_action: ToolAction): Promise<ToolResult> => ({
        success: true,
        data: "secondary result",
        duration_ms: 5,
      }),
      healthCheck: async (): Promise<boolean> => true,
      disconnect: async (): Promise<void> => { return; },
      getCapabilities: (): ToolCapability[] => [],
    };

    // 2. Build the sub-adapters map with both tools
    const subAdapters = new Map<string, ToolAdapter>([
      ["primary-tool", primaryAdapter],
      ["secondary-tool", secondaryAdapter],
    ]);

    // 3. Create CompositeAdapter with fallback strategy
    const adapter = new CompositeAdapter(
      "composite-1",
      {
        type: "composite",
        sub_tools: ["primary-tool", "secondary-tool"],
        strategy: "fallback",
      },
      subAdapters,
      [],
    );

    // 4. Connect — primary connect() is a no-op; secondary connect() is also a no-op
    await adapter.connect();

    // 5. Execute through the composite adapter
    const result = await adapter.execute({
      tool_id: "composite-1",
      capability: "test",
      params: {},
      agent_id: "a1",
    });

    // 6. The fallback must succeed using the secondary
    expect(result.success).toBe(true);

    // 7. The data must come from the secondary adapter
    expect(result.data).toBe("secondary result");
  });
});
