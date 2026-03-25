/**
 * Tests for Step 2: FILESYSTEM
 *
 * Covers:
 * - planFilesystem produces correct ops for business mode
 * - planFilesystem produces correct ops for personal mode
 * - executeFilesystemOps creates directories and writes files
 * - Idempotency: running executeFilesystemOps twice produces identical on-disk state
 * - Deactivated divisions do NOT get directories created
 * - divisionMeta shape
 * - Path traversal guard
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planFilesystem, executeFilesystemOps, applyFilesystem, divisionMeta } from "../../src/apply/filesystem.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";
import type { FilesystemOp } from "../../src/types/apply.js";
import { ApplyError } from "../../src/types/apply.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDiv(
  code: string,
  active = true,
  required = false,
): Division {
  return {
    code,
    name: { en: code.charAt(0).toUpperCase() + code.slice(1) },
    scope: `Scope for ${code}`,
    required,
    active,
    recommend_from: null,
    head: { role: null, agent: null },
  };
}

function makeBusinessConfig(divisions: Division[]): ParsedConfig {
  return {
    schema_version: "1.0",
    company: {
      name: "Test Corp",
      size: "solo",
      locale: "en",
      timezone: "UTC",
      mode: "business",
    },
    mode: "business",
    divisions,
    activeDivisions: divisions.filter((d) => d.active),
    size_presets: {
      solo: { recommended: [], description: "" },
    },
    sourcePath: "/test/divisions.yaml",
    contentHash: "abc123",
  };
}

function makePersonalConfig(): ParsedConfig {
  return {
    schema_version: "1.0",
    company: {
      name: "My Workspace",
      size: "personal",
      locale: "en",
      timezone: "UTC",
      mode: "personal",
    },
    mode: "personal",
    divisions: [],
    activeDivisions: [],
    size_presets: {},
    sourcePath: "/test/divisions.yaml",
    contentHash: "def456",
  };
}

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "sidjua-test-fs-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// planFilesystem — business mode
// ---------------------------------------------------------------------------

describe("planFilesystem — business mode", () => {
  it("generates mkdir ops for each active division's subdirs", () => {
    const config = makeBusinessConfig([makeDiv("engineering"), makeDiv("product")]);
    const ops = planFilesystem(config);

    const mkdirPaths = ops.filter((o) => o.type === "mkdir").map((o) => o.path);

    // Each active division should have 6 subdirs
    expect(mkdirPaths).toContain("/engineering/inbox");
    expect(mkdirPaths).toContain("/engineering/outbox");
    expect(mkdirPaths).toContain("/engineering/workspace");
    expect(mkdirPaths).toContain("/engineering/knowledge");
    expect(mkdirPaths).toContain("/engineering/archive");
    expect(mkdirPaths).toContain("/engineering/.meta");
    expect(mkdirPaths).toContain("/product/inbox");
  });

  it("generates write op for division.json (overwrite:true)", () => {
    const config = makeBusinessConfig([makeDiv("engineering")]);
    const ops = planFilesystem(config);

    const writeOp = ops.find(
      (o) => o.type === "write" && o.path === "/engineering/.meta/division.json",
    );
    expect(writeOp).toBeDefined();
    expect(writeOp!.overwrite).toBe(true);
    expect(writeOp!.content).toBeDefined();

    const meta = JSON.parse(writeOp!.content!) as Record<string, unknown>;
    expect(meta["code"]).toBe("engineering");
  });

  it("always includes /.system and /archive regardless of divisions", () => {
    const config = makeBusinessConfig([]);
    const ops = planFilesystem(config);
    const paths = ops.map((o) => o.path);
    expect(paths).toContain("/.system");
    expect(paths).toContain("/archive");
  });

  it("does NOT generate ops for inactive divisions", () => {
    const active = makeDiv("engineering", true);
    const inactive = makeDiv("hr", false);
    const config = makeBusinessConfig([active, inactive]);
    const ops = planFilesystem(config);
    const paths = ops.map((o) => o.path);

    expect(paths.some((p) => p.startsWith("/engineering"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/hr"))).toBe(false);
  });

  it("mkdir ops have overwrite:false (idempotent)", () => {
    const config = makeBusinessConfig([makeDiv("engineering")]);
    const ops = planFilesystem(config);
    const mkdirOps = ops.filter((o) => o.type === "mkdir");
    expect(mkdirOps.every((o) => o.overwrite === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// planFilesystem — personal mode
// ---------------------------------------------------------------------------

describe("planFilesystem — personal mode", () => {
  it("generates workspace subdirs", () => {
    const ops = planFilesystem(makePersonalConfig());
    const paths = ops.map((o) => o.path);
    expect(paths).toContain("/workspace/projects");
    expect(paths).toContain("/workspace/knowledge");
    expect(paths).toContain("/workspace/templates");
  });

  it("generates ai-governance subdirs", () => {
    const ops = planFilesystem(makePersonalConfig());
    const paths = ops.map((o) => o.path);
    expect(paths).toContain("/ai-governance/agents");
    expect(paths).toContain("/ai-governance/skills");
    expect(paths).toContain("/ai-governance/audit-trail");
  });

  it("generates governance directory and boundary files", () => {
    const ops = planFilesystem(makePersonalConfig());
    const paths = ops.map((o) => o.path);
    expect(paths).toContain("/governance");
    expect(paths).toContain("/governance/boundaries");
    expect(paths).toContain("/governance/my-rules.yaml");
    expect(paths).toContain("/governance/boundaries/forbidden-actions.yaml");
  });

  it("governance template files have overwrite:false (preserve user customizations)", () => {
    const ops = planFilesystem(makePersonalConfig());
    const templateOps = ops.filter(
      (o) =>
        o.path === "/governance/my-rules.yaml" ||
        o.path === "/governance/boundaries/forbidden-actions.yaml",
    );
    expect(templateOps.length).toBe(2);
    expect(templateOps.every((o) => o.overwrite === false)).toBe(true);
  });

  it("always includes /.system and /archive", () => {
    const ops = planFilesystem(makePersonalConfig());
    const paths = ops.map((o) => o.path);
    expect(paths).toContain("/.system");
    expect(paths).toContain("/archive");
  });

  it("does not generate division directories in personal mode", () => {
    const ops = planFilesystem(makePersonalConfig());
    const paths = ops.map((o) => o.path);
    // No division-code paths (like /engineering)
    expect(paths.every((p) => !p.match(/^\/[a-z][a-z0-9-]*\/(inbox|outbox|workspace)/))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// executeFilesystemOps — creates directories
// ---------------------------------------------------------------------------

describe("executeFilesystemOps — directory creation", () => {
  it("creates directories that do not exist", () => {
    const ops: FilesystemOp[] = [
      { type: "mkdir", path: "/engineering/inbox", overwrite: false },
      { type: "mkdir", path: "/engineering/.meta", overwrite: false },
    ];
    const result = executeFilesystemOps(ops, workDir);
    expect(result.created).toBe(2);
    expect(existsSync(join(workDir, "engineering/inbox"))).toBe(true);
    expect(existsSync(join(workDir, "engineering/.meta"))).toBe(true);
  });

  it("skips directories that already exist (overwrite:false)", () => {
    const ops: FilesystemOp[] = [
      { type: "mkdir", path: "/engineering/inbox", overwrite: false },
    ];
    // First run
    executeFilesystemOps(ops, workDir);
    // Second run — should skip
    const result = executeFilesystemOps(ops, workDir);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// executeFilesystemOps — file writing
// ---------------------------------------------------------------------------

describe("executeFilesystemOps — file writing", () => {
  it("writes files when they do not exist", () => {
    const ops: FilesystemOp[] = [
      {
        type: "write",
        path: "/engineering/.meta/division.json",
        content: '{"code":"engineering"}',
        overwrite: false,
      },
    ];
    const result = executeFilesystemOps(ops, workDir);
    expect(result.written).toBe(1);
    const content = readFileSync(join(workDir, "engineering/.meta/division.json"), "utf-8");
    expect(content).toBe('{"code":"engineering"}');
  });

  it("skips existing file when overwrite:false", () => {
    const ops: FilesystemOp[] = [
      {
        type: "write",
        path: "/engineering/.meta/division.json",
        content: "original",
        overwrite: false,
      },
    ];
    executeFilesystemOps(ops, workDir);
    // Second run with different content but overwrite:false
    const ops2: FilesystemOp[] = [
      {
        type: "write",
        path: "/engineering/.meta/division.json",
        content: "updated",
        overwrite: false,
      },
    ];
    const result = executeFilesystemOps(ops2, workDir);
    expect(result.skipped).toBe(1);
    // File content must be unchanged
    const content = readFileSync(join(workDir, "engineering/.meta/division.json"), "utf-8");
    expect(content).toBe("original");
  });

  it("overwrites existing file when overwrite:true", () => {
    const ops: FilesystemOp[] = [
      {
        type: "write",
        path: "/engineering/.meta/division.json",
        content: "original",
        overwrite: false,
      },
    ];
    executeFilesystemOps(ops, workDir);
    // Second run with overwrite:true
    const ops2: FilesystemOp[] = [
      {
        type: "write",
        path: "/engineering/.meta/division.json",
        content: "updated",
        overwrite: true,
      },
    ];
    executeFilesystemOps(ops2, workDir);
    const content = readFileSync(join(workDir, "engineering/.meta/division.json"), "utf-8");
    expect(content).toBe("updated");
  });

  it("creates parent directories automatically when writing", () => {
    const ops: FilesystemOp[] = [
      {
        type: "write",
        path: "/deep/nested/dir/file.json",
        content: "{}",
        overwrite: false,
      },
    ];
    executeFilesystemOps(ops, workDir);
    expect(existsSync(join(workDir, "deep/nested/dir/file.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("Idempotency — running applyFilesystem twice produces same result", () => {
  it("business mode: second run skips all dirs and writes division.json", () => {
    const config = makeBusinessConfig([makeDiv("engineering"), makeDiv("product")]);

    const first = applyFilesystem(config, workDir);
    const second = applyFilesystem(config, workDir);

    // First run: all created
    expect(first.created).toBeGreaterThan(0);

    // Second run: zero new dirs created; division.json files re-written (overwrite:true)
    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
    // division.json files are overwrite:true so they count as written (not skipped)
    expect(second.written).toBe(config.activeDivisions.length);
  });

  it("personal mode: second run skips all dirs and template files", () => {
    const config = makePersonalConfig();

    const first = applyFilesystem(config, workDir);
    const second = applyFilesystem(config, workDir);

    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("business mode: on-disk state is identical after two runs", () => {
    const config = makeBusinessConfig([makeDiv("engineering")]);

    applyFilesystem(config, workDir);

    const divJson1 = readFileSync(
      join(workDir, "engineering/.meta/division.json"),
      "utf-8",
    );

    applyFilesystem(config, workDir);

    const divJson2 = readFileSync(
      join(workDir, "engineering/.meta/division.json"),
      "utf-8",
    );

    // Parsed content (minus generated_at timestamp) should be equivalent
    const meta1 = JSON.parse(divJson1) as Record<string, unknown>;
    const meta2 = JSON.parse(divJson2) as Record<string, unknown>;

    expect(meta1["code"]).toBe(meta2["code"]);
    expect(meta1["active"]).toBe(meta2["active"]);
    expect(meta1["scope"]).toBe(meta2["scope"]);
  });

  it("deactivated division directories are NOT created on re-apply", () => {
    const active = makeDiv("engineering", true);
    const inactive = makeDiv("hr", false);
    const config = makeBusinessConfig([active, inactive]);

    applyFilesystem(config, workDir);
    applyFilesystem(config, workDir);

    expect(existsSync(join(workDir, "engineering/inbox"))).toBe(true);
    expect(existsSync(join(workDir, "hr/inbox"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// divisionMeta
// ---------------------------------------------------------------------------

describe("divisionMeta", () => {
  it("includes all required fields", () => {
    const div = makeDiv("engineering", true, true);
    const meta = divisionMeta(div);
    expect(meta["code"]).toBe("engineering");
    expect(meta["active"]).toBe(true);
    expect(meta["required"]).toBe(true);
    expect(meta["head"]).toBeDefined();
    expect(meta["name"]).toBeDefined();
    expect(meta["scope"]).toBeDefined();
    expect(meta["generated_at"]).toBeDefined();
  });

  it("generated_at is a valid ISO 8601 string", () => {
    const meta = divisionMeta(makeDiv("engineering"));
    expect(typeof meta["generated_at"]).toBe("string");
    expect(new Date(meta["generated_at"] as string).toISOString()).toBe(meta["generated_at"]);
  });
});

// ---------------------------------------------------------------------------
// Security: path traversal guard
// ---------------------------------------------------------------------------

describe("executeFilesystemOps — path traversal guard", () => {
  it("throws ApplyError for path that escapes workDir", () => {
    const ops: FilesystemOp[] = [
      { type: "mkdir", path: "/../../../etc", overwrite: false },
    ];
    expect(() => executeFilesystemOps(ops, workDir)).toThrow(ApplyError);
  });
});

// ---------------------------------------------------------------------------
// executeFilesystemOps return value accuracy
// ---------------------------------------------------------------------------

describe("executeFilesystemOps — return value accuracy", () => {
  it("ops array in result matches input ops", () => {
    const ops: FilesystemOp[] = [
      { type: "mkdir", path: "/.system", overwrite: false },
    ];
    const result = executeFilesystemOps(ops, workDir);
    expect(result.ops).toBe(ops); // same reference
  });

  it("created + skipped + written totals match ops count for simple case", () => {
    const ops: FilesystemOp[] = [
      { type: "mkdir", path: "/a", overwrite: false },
      { type: "mkdir", path: "/b", overwrite: false },
      { type: "write", path: "/c/file.txt", content: "hello", overwrite: false },
    ];
    const result = executeFilesystemOps(ops, workDir);
    expect(result.created + result.skipped + result.written).toBe(ops.length);
  });
});
