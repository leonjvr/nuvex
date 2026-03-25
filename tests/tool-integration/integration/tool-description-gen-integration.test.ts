/**
 * Integration test: Tool Description Generator
 *
 * Covers: generate() produces a correct ToolDescription from a DB-loaded tool
 * and its capabilities; toMarkdown() formats it with the expected header.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../../src/tool-integration/migration.js";
import { ToolRegistry } from "../../../src/tool-integration/tool-registry.js";
import { ToolDescriptionGen } from "../../../src/tool-integration/tool-description-gen.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  runToolMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("Tool Description Gen — Integration", () => {
  it("generates full description with DB-loaded tool and capabilities", () => {
    // 1. Create ToolRegistry and register a tool with multiple capabilities
    const registry = new ToolRegistry(db);
    registry.create({
      id: "desc-tool",
      name: "Description Test Tool",
      type: "shell",
      config: { type: "shell", allowed_commands: ["echo", "ls"] },
      capabilities: [
        {
          name: "execute",
          description: "Run a shell command",
          risk_level: "low",
          requires_approval: false,
          input_schema: { command: { type: "string" } },
          output_schema: { stdout: { type: "string" } },
        },
        {
          name: "list_files",
          description: "List directory contents",
          risk_level: "low",
          requires_approval: false,
          input_schema: { dir: { type: "string" } },
          output_schema: { files: { type: "array" } },
        },
      ],
    });

    // 2. Create ToolDescriptionGen backed by the same registry
    const gen = new ToolDescriptionGen(registry);

    // 3. Generate a description for the registered tool
    const description = gen.generate("desc-tool");

    // Verify name matches
    expect(description.name).toBe("Description Test Tool");

    // Verify at least one capability is present
    expect(description.capabilities.length).toBeGreaterThan(0);

    // Verify the first capability has a name
    const firstCap = description.capabilities[0]!;
    expect(firstCap.name).toBeTruthy();

    // 4. Render to Markdown and verify the section header is present
    const markdown = gen.toMarkdown([description]);
    expect(markdown).toContain("## Tool:");
    expect(markdown).toContain("Description Test Tool");
  });
});
