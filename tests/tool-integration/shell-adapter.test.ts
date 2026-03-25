/**
 * Unit tests: ShellAdapter
 */

import { describe, it, expect } from "vitest";
import { ShellAdapter } from "../../src/tool-integration/adapters/shell-adapter.js";
import type { ToolAction } from "../../src/tool-integration/types.js";

describe("ShellAdapter", () => {
  it("executes an allowed command successfully", async () => {
    const adapter = new ShellAdapter(
      "s1",
      { type: "shell", allowed_commands: ["echo"] },
      [],
    );
    await adapter.connect();

    const action: ToolAction = {
      tool_id: "s1",
      capability: "execute",
      params: { command: "echo hello" },
      agent_id: "a1",
    };

    const result = await adapter.execute(action);

    expect(result.success).toBe(true);
    const data = result.data as { stdout: string; stderr: string };
    expect(data.stdout.trim()).toContain("hello");
  });

  it("throws during construction when allowed_commands is not provided", () => {
    // P272 Task 3: allowlist is now mandatory
    expect(() => new ShellAdapter("s1", { type: "shell" }, [])).toThrow("allowed_commands");
  });

  it("rejects a command not in the allowed list", async () => {
    // P272 Task 3: command not in allowedSet is blocked
    const adapter = new ShellAdapter("s1", { type: "shell", allowed_commands: ["echo"] }, []);
    await adapter.connect();

    const action: ToolAction = {
      tool_id: "s1",
      capability: "execute",
      params: { command: "rm -rf /tmp/test" },
      agent_id: "a1",
    };

    const result = await adapter.execute(action);

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toContain("rm");
  });

  it("fails gracefully when output exceeds max_output_bytes", async () => {
    // Set a very small max buffer (5 bytes) so even 'echo hello world' (>5 bytes) overflows
    const adapter = new ShellAdapter(
      "s1",
      {
        type: "shell",
        allowed_commands: ["echo"],
        max_output_bytes: 5,
      },
      [],
    );
    await adapter.connect();

    const action: ToolAction = {
      tool_id: "s1",
      capability: "execute",
      // "hello world\n" is 12 bytes, well over the 5-byte limit
      params: { command: "echo hello world" },
      agent_id: "a1",
    };

    const result = await adapter.execute(action);

    // execFileAsync throws when maxBuffer is exceeded; the adapter catches it
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});
