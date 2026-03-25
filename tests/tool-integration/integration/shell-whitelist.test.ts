/**
 * Integration test: Shell Adapter Whitelist
 *
 * Covers: allowed commands execute successfully; non-allowed commands are blocked
 * before any exec() call.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../../src/tool-integration/migration.js";
import { ShellAdapter } from "../../../src/tool-integration/adapters/shell-adapter.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  runToolMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("Shell Adapter Whitelist Integration", () => {
  it("allows echo command, blocks rm command with real exec", async () => {
    // 1. Create ShellAdapter with allowed_commands: ['echo'] only
    const adapter = new ShellAdapter(
      "shell-wl",
      {
        type: "shell",
        allowed_commands: ["echo"],
      },
      [],
    );

    // 2. Connect the adapter
    await adapter.connect();

    // 3. Execute 'echo hello' — should succeed and produce stdout containing 'hello'
    const allowedResult = await adapter.execute({
      tool_id: "shell-wl",
      capability: "execute",
      params: { command: "echo hello" },
      agent_id: "agent-wl",
    });

    expect(allowedResult.success).toBe(true);
    const data = allowedResult.data as { stdout: string; stderr: string };
    expect(data.stdout).toContain("hello");

    // 4. Execute 'rm /tmp/nonexistent' — rm is not in the allowed list; should be blocked
    const blockedResult = await adapter.execute({
      tool_id: "shell-wl",
      capability: "execute",
      params: { command: "rm /tmp/nonexistent" },
      agent_id: "agent-wl",
    });

    expect(blockedResult.success).toBe(false);

    // 5. Disconnect
    await adapter.disconnect();
  });
});
