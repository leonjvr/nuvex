/**
 * Unit tests: FilesystemAdapter
 */

import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdtempSync, unlinkSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FilesystemAdapter } from "../../src/tool-integration/adapters/filesystem-adapter.js";
import type { ToolAction } from "../../src/tool-integration/types.js";

describe("FilesystemAdapter", () => {
  let tmpDir: string;
  let tmpFilePath: string;

  beforeEach(() => {
    // Create a fresh temp dir and file for each test
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "sidjua-fs-test-"));
    tmpFilePath = path.join(tmpDir, "test-file.txt");
    writeFileSync(tmpFilePath, "hello from test file");
  });

  it("reads a file within allowed path", async () => {
    const adapter = new FilesystemAdapter(
      "fs1",
      {
        type: "filesystem",
        allowed_paths: [tmpDir],
      },
      [],
    );
    await adapter.connect();

    const action: ToolAction = {
      tool_id: "fs1",
      capability: "read_file",
      params: { path: tmpFilePath },
      agent_id: "a1",
    };

    const result = await adapter.execute(action);

    expect(result.success).toBe(true);
    expect(result.data).toBe("hello from test file");
  });

  it("blocks access to file outside allowed path", async () => {
    // tmpDir is something like /tmp/sidjua-fs-test-XXXX — /etc is not inside it
    const adapter = new FilesystemAdapter(
      "fs1",
      {
        type: "filesystem",
        allowed_paths: [tmpDir],
      },
      [],
    );
    await adapter.connect();

    const action: ToolAction = {
      tool_id: "fs1",
      capability: "read_file",
      params: { path: "/etc/passwd" },
      agent_id: "a1",
    };

    const result = await adapter.execute(action);

    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    // Error should mention the path was not allowed
    expect(result.error).toContain("allowed");
  });
});
