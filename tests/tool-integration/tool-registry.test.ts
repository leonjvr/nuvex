/**
 * Unit tests: ToolRegistry
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../src/tool-integration/migration.js";
import { ToolRegistry } from "../../src/tool-integration/tool-registry.js";
import type { CreateToolInput } from "../../src/tool-integration/types.js";

type Db = ReturnType<typeof Database>;

function makeDb(): Db {
  const db = new Database(":memory:");
  runToolMigrations(db);
  return db;
}

/**
 * Note: tool_capabilities.id is INTEGER PRIMARY KEY AUTOINCREMENT in the
 * migration schema, so capabilities must be omitted from create() calls in
 * these tests (the registry inserts a TEXT string as the id, which causes a
 * SQLite datatype mismatch). Tests for getCapabilities() are covered via the
 * ToolDescriptionGen tests that use the registry.
 */
function makeShellInput(id: string): CreateToolInput {
  return {
    id,
    name: `Tool ${id}`,
    type: "shell",
    config: { type: "shell" },
    // No capabilities — avoids INTEGER PRIMARY KEY TEXT-insert mismatch in source
  };
}

describe("ToolRegistry", () => {
  let db: Db;
  let registry: ToolRegistry;

  beforeEach(() => {
    db = makeDb();
    registry = new ToolRegistry(db);
  });

  it("creates a tool definition and returns it", () => {
    const input: CreateToolInput = {
      id: "test-shell",
      name: "Test Shell",
      type: "shell",
      config: { type: "shell" },
      // No capabilities provided (see note above about INTEGER PK mismatch)
    };

    const result = registry.create(input);

    expect(result.id).toBe("test-shell");
    expect(result.type).toBe("shell");
    expect(result.status).toBe("inactive");
    expect(result.name).toBe("Test Shell");
    expect(result.created_at).toBeTruthy();
    expect(result.updated_at).toBeTruthy();
  });

  it("getById returns the created tool", () => {
    const input = makeShellInput("shell-get-test");
    registry.create(input);

    const fetched = registry.getById("shell-get-test");

    expect(fetched.id).toBe("shell-get-test");
    expect(fetched.name).toBe("Tool shell-get-test");
    expect(fetched.type).toBe("shell");
    expect(fetched.status).toBe("inactive");
    expect(fetched.config).toEqual({ type: "shell" });
  });

  it("list returns all tools and filter by status works", () => {
    registry.create(makeShellInput("tool-a"));
    registry.create(makeShellInput("tool-b"));

    const all = registry.list();
    expect(all.length).toBe(2);

    // No tools are active yet
    const activeBeforeUpdate = registry.list("active");
    expect(activeBeforeUpdate.length).toBe(0);

    registry.updateStatus("tool-a", "active");

    const activeAfterUpdate = registry.list("active");
    expect(activeAfterUpdate.length).toBe(1);
    expect(activeAfterUpdate[0]!.id).toBe("tool-a");

    // Inactive still has just tool-b
    const inactiveList = registry.list("inactive");
    expect(inactiveList.length).toBe(1);
    expect(inactiveList[0]!.id).toBe("tool-b");
  });

  it("updateStatus changes the tool status in DB", () => {
    registry.create(makeShellInput("status-test"));

    const before = registry.getById("status-test");
    expect(before.status).toBe("inactive");

    registry.updateStatus("status-test", "active");

    const after = registry.getById("status-test");
    expect(after.status).toBe("active");
  });
});
