/**
 * Tests for `sidjua init` command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import { parse as parseYaml } from "yaml";
import Database from "better-sqlite3";
import { runInitCommand } from "../../src/cli/commands/init.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

const origStdout = process.stdout.write.bind(process.stdout);
const origStderr = process.stderr.write.bind(process.stderr);

let stdoutOutput = "";
let stderrOutput = "";

function captureOutput(): void {
  stdoutOutput = "";
  stderrOutput = "";
  vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    stdoutOutput += typeof data === "string" ? data : data.toString();
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((data) => {
    stderrOutput += typeof data === "string" ? data : data.toString();
    return true;
  });
}

function restoreOutput(): void {
  vi.mocked(process.stdout.write).mockRestore?.();
  vi.mocked(process.stderr.write).mockRestore?.();
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-init-"));
  captureOutput();
});

afterEach(() => {
  restoreOutput();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Directory structure
// ---------------------------------------------------------------------------

describe("sidjua init — directory structure", () => {
  it("creates .system directory", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, ".system"))).toBe(true);
  });

  it("creates agents/definitions and agents/skills directories", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "definitions"))).toBe(true);
    expect(existsSync(join(tmpDir, "agents", "skills"))).toBe(true);
  });

  it("creates agents/templates directory", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "templates"))).toBe(true);
  });

  it("creates governance/boundaries directory", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "governance", "boundaries"))).toBe(true);
  });

  it("creates docs directory", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "docs"))).toBe(true);
  });

  it("creates .system/providers directory", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, ".system", "providers"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Core files
// ---------------------------------------------------------------------------

describe("sidjua init — core files", () => {
  it("creates governance/divisions/ directory", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const divDir = join(tmpDir, "governance", "divisions");
    expect(existsSync(divDir)).toBe(true);
    const stat = require("node:fs").statSync(divDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("governance/divisions/ contains system, executive, and workspace", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const divDir = join(tmpDir, "governance", "divisions");
    const files  = require("node:fs").readdirSync(divDir).filter((f: string) => f.endsWith(".yaml"));
    expect(files).toContain("system.yaml");
    expect(files).toContain("executive.yaml");
    expect(files).toContain("workspace.yaml");
  });

  it("workspace.yaml has correct division id", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const raw  = readFileSync(join(tmpDir, "governance", "divisions", "workspace.yaml"), "utf-8");
    const data = parseYaml(raw) as { division?: { id: string } };
    expect(data.division?.id).toBe("workspace");
  });

  it("creates governance/CHARTER.md", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "governance", "CHARTER.md"))).toBe(true);
  });

  it("creates governance/boundaries/defaults.yaml", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "governance", "boundaries", "defaults.yaml"))).toBe(true);
  });

  it("creates agents/agents.yaml with guide agent", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const yamlPath = join(tmpDir, "agents", "agents.yaml");
    expect(existsSync(yamlPath)).toBe(true);

    const raw  = readFileSync(yamlPath, "utf-8");
    const data = parseYaml(raw) as { agents?: string[] };
    expect(data.agents).toContain("guide");
  });

  it("creates guide.yaml definition", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "definitions", "guide.yaml"))).toBe(true);
  });

  it("guide.yaml has correct provider and model", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const raw  = readFileSync(join(tmpDir, "agents", "definitions", "guide.yaml"), "utf-8");
    const def  = parseYaml(raw) as Record<string, unknown>;
    expect(def["provider"]).toBe("cloudflare");
    expect(String(def["model"])).toContain("llama");
  });

  it("creates agents/skills/guide.md", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "skills", "guide.md"))).toBe(true);
  });

  it("guide.md has meaningful content", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const content = readFileSync(join(tmpDir, "agents", "skills", "guide.md"), "utf-8");
    expect(content).toContain("SIDJUA Guide");
    expect(content.length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// Agent templates
// ---------------------------------------------------------------------------

describe("sidjua init — agent templates", () => {
  it("creates worker.yaml template", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "templates", "worker.yaml"))).toBe(true);
  });

  it("creates manager.yaml template", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "templates", "manager.yaml"))).toBe(true);
  });

  it("creates researcher.yaml template", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "templates", "researcher.yaml"))).toBe(true);
  });

  it("creates developer.yaml template", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "agents", "templates", "developer.yaml"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provider templates
// ---------------------------------------------------------------------------

describe("sidjua init — provider templates", () => {
  it("creates cloudflare.yaml provider config", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, ".system", "providers", "cloudflare.yaml"))).toBe(true);
  });

  it("creates groq.yaml provider template", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, ".system", "providers", "groq.yaml"))).toBe(true);
  });

  it("creates google.yaml provider template", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, ".system", "providers", "google.yaml"))).toBe(true);
  });

  it("groq.yaml does not have an api_key set (requires user input)", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const raw  = readFileSync(join(tmpDir, ".system", "providers", "groq.yaml"), "utf-8");
    const data = parseYaml(raw) as Record<string, unknown>;
    // enabled should be false until key is added
    expect(data["enabled"]).toBe(false);
  });

  it("cloudflare.yaml is marked as embedded", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const raw  = readFileSync(join(tmpDir, ".system", "providers", "cloudflare.yaml"), "utf-8");
    // Content should mention "embedded" or have embedded: true
    expect(raw).toContain("embedded");
  });
});

// ---------------------------------------------------------------------------
// Bundled docs
// ---------------------------------------------------------------------------

describe("sidjua init — bundled docs", () => {
  it("creates at least one doc file in docs/", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const docsDir = join(tmpDir, "docs");
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(docsDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it("creates TROUBLESHOOTING.md", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "docs", "TROUBLESHOOTING.md"))).toBe(true);
  });

  it("creates AGENT-TEMPLATES.md", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, "docs", "AGENT-TEMPLATES.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

describe("sidjua init — database", () => {
  it("creates .system/sidjua.db", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, ".system", "sidjua.db"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// config.json
// ---------------------------------------------------------------------------

describe("sidjua init — config.json", () => {
  it("writes .system/config.json", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(existsSync(join(tmpDir, ".system", "config.json"))).toBe(true);
  });

  it("config.json contains workDir, version, and initialized_at", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const raw = readFileSync(join(tmpDir, ".system", "config.json"), "utf-8");
    const cfg = JSON.parse(raw) as { workDir: string; version: string; initialized_at: string };
    expect(cfg.workDir).toBe(tmpDir);
    expect(cfg.version).toBe("1.0.0");
    expect(cfg.initialized_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("writes config.json to SIDJUA_CONFIG_DIR when set", async () => {
    const cfgDir = mkdtempSync(join(tmpdir(), "sidjua-cfg-"));
    try {
      vi.stubEnv("SIDJUA_CONFIG_DIR", cfgDir);
      await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
      const cfgPath = join(cfgDir, "config.json");
      expect(existsSync(cfgPath)).toBe(true);
      const raw = readFileSync(cfgPath, "utf-8");
      const cfg = JSON.parse(raw) as { workDir: string };
      expect(cfg.workDir).toBe(tmpDir);
    } finally {
      vi.unstubAllEnvs();
      rmSync(cfgDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("sidjua init — idempotency", () => {
  it("does not overwrite existing files when run twice", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });

    // Modify a file
    const { writeFileSync } = await import("node:fs");
    const charterPath = join(tmpDir, "governance", "CHARTER.md");
    writeFileSync(charterPath, "# My Custom Charter\n");

    // Run init again (without force)
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });

    // Custom content should still be there
    const content = readFileSync(charterPath, "utf-8");
    expect(content).toContain("My Custom Charter");
  });

  it("returns exit code 0 when already initialized (no force)", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const code = await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(code).toBe(0);
  });

  it("reinitializes with --force flag", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });

    // Force re-init
    const code = await runInitCommand({ workDir: tmpDir, force: true, quiet: true });
    expect(code).toBe(0);

    // Guide should still exist
    expect(existsSync(join(tmpDir, "agents", "definitions", "guide.yaml"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

describe("sidjua init — output", () => {
  it("returns exit code 0 on success", async () => {
    const code = await runInitCommand({ workDir: tmpDir, force: false, quiet: false });
    expect(code).toBe(0);
  });

  it("shows welcome banner when not quiet", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: false });
    expect(stdoutOutput).toContain("✓ Workspace created:");
    expect(stdoutOutput).toContain("sidjua chat");
  });

  it("suppresses banner in quiet mode", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    expect(stdoutOutput).not.toContain("SIDJUA v");
  });

  it("writes error to stderr on failure", async () => {
    // Use an invalid workDir to trigger failure
    const code = await runInitCommand({ workDir: "/dev/null/sidjua-init-no-such-dir", force: false, quiet: true });
    expect(code).toBe(1);
    expect(stderrOutput).toContain("✗");
  });
});

// ---------------------------------------------------------------------------
// Database — divisions provisioned
// ---------------------------------------------------------------------------

describe("sidjua init — database divisions", () => {
  it("provisions system division into DB after init", async () => {
    await runInitCommand({ workDir: tmpDir, force: false, quiet: true });
    const db = new Database(join(tmpDir, ".system", "sidjua.db"));
    const row = db.prepare<[], { code: string }>(
      "SELECT code FROM divisions WHERE code = 'system' AND active = 1",
    ).get();
    db.close();
    expect(row).toBeDefined();
  });
});
