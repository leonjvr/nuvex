/**
 * Unit tests: ToolActionResolver
 */

import { describe, it, expect } from "vitest";
import { ToolActionResolver } from "../../src/tool-integration/tool-action-resolver.js";

describe("ToolActionResolver", () => {
  const resolver = new ToolActionResolver();

  it("resolves a capability name as-is when no translation needed", () => {
    // 'query' is not in the translation table, so it passes through unchanged
    const action = resolver.resolve("query", { sql: "SELECT 1" }, "db-1", undefined, "agent-1");

    expect(action.capability).toBe("query");
    expect(action.tool_id).toBe("db-1");
    expect(action.agent_id).toBe("agent-1");
    expect(action.params["sql"]).toBe("SELECT 1");
  });

  it("translates create_directory to unix command on macos", () => {
    const action = resolver.resolve(
      "create_directory",
      { path: "/tmp/test" },
      "shell-1",
      "macos",
      "agent-1",
    );

    // Should be translated; capability becomes shell_exec
    expect(action.capability).toBe("shell_exec");
    expect(action.tool_id).toBe("shell-1");
    expect(typeof action.params["command"]).toBe("string");
    const command = action.params["command"] as string;
    expect(command).toContain("mkdir -p /tmp/test");
  });

  it("translates create_directory to PowerShell command on windows-11", () => {
    const action = resolver.resolve(
      "create_directory",
      { path: "C:\\test" },
      "shell-1",
      "windows-11",
      "agent-1",
    );

    expect(action.capability).toBe("shell_exec");
    expect(typeof action.params["command"]).toBe("string");
    const command = action.params["command"] as string;
    expect(command).toContain("New-Item");
  });
});
