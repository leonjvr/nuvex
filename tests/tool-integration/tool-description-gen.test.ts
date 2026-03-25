/**
 * Unit tests: ToolDescriptionGen
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../src/tool-integration/migration.js";
import { ToolRegistry } from "../../src/tool-integration/tool-registry.js";
import { ToolDescriptionGen } from "../../src/tool-integration/tool-description-gen.js";
import type { CreateToolInput } from "../../src/tool-integration/types.js";

type Db = ReturnType<typeof Database>;

function makeDb(): Db {
  const db = new Database(":memory:");
  runToolMigrations(db);
  return db;
}

/**
 * Insert a capability directly via SQL, letting AUTOINCREMENT handle the id.
 * This is needed because ToolRegistry.create() erroneously passes a TEXT value
 * for the INTEGER PRIMARY KEY column; this helper bypasses that bug.
 */
function insertCapability(
  db: Db,
  toolId: string,
  name: string,
  description: string,
): void {
  db.prepare(
    `INSERT INTO tool_capabilities
       (tool_id, name, description, risk_level, requires_approval, input_schema, output_schema)
     VALUES (?, ?, ?, 'low', 0, '{}', '{}')`,
  ).run(toolId, name, description);
}

describe("ToolDescriptionGen", () => {
  let db: Db;
  let registry: ToolRegistry;
  let gen: ToolDescriptionGen;

  beforeEach(() => {
    db = makeDb();
    registry = new ToolRegistry(db);
    gen = new ToolDescriptionGen(registry);
  });

  it("generates description including capability names", () => {
    const input: CreateToolInput = {
      id: "shell-desc-test",
      name: "Shell Desc Test",
      type: "shell",
      config: { type: "shell" },
      // No capabilities in create() — insert directly below to avoid PK mismatch
    };
    registry.create(input);

    // Insert the capability row directly using AUTOINCREMENT
    insertCapability(db, "shell-desc-test", "execute", "Run shell commands");

    const description = gen.generate("shell-desc-test");

    expect(description.tool_id).toBe("shell-desc-test");
    expect(description.capabilities.length).toBe(1);
    expect(description.capabilities[0]!.name).toBe("execute");
    // Summary should mention the tool type
    expect(description.summary).toContain("shell");
  });

  it("masks credentials in tool config (token/password/secret/key values)", () => {
    // Create a rest tool with a bearer token in its auth config
    const input: CreateToolInput = {
      id: "rest-creds-test",
      name: "REST Creds Test",
      type: "rest",
      config: {
        type: "rest",
        base_url: "http://api.example.com",
        auth: {
          type: "bearer",
          token: "my-secret-token",
        },
      },
    };
    registry.create(input);

    // generate() calls maskCredentials internally on the config before building
    // the description. Verify the raw token never leaks into the output.
    const description = gen.generate("rest-creds-test");

    // The summary string should not expose the raw token
    expect(description.summary).not.toContain("my-secret-token");

    // Serializing the full description object must not contain the raw token
    expect(JSON.stringify(description)).not.toContain("my-secret-token");

    // toMarkdown should also be clean
    const markdown = gen.toMarkdown([description]);
    expect(markdown).not.toContain("my-secret-token");
  });
});
