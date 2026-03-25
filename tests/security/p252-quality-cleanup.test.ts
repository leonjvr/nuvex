// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Regression tests for P252 — MEDIUM Quality & Cleanup
 *
 * Eight fixes covering:
 *   FIX-1: formatJson — valid JSON on truncation (never slice mid-string)
 *   FIX-2: email.ts loadEmailEnv — ESM import, no require()
 *   FIX-3: migrate-embeddings — hidden behind --experimental flag
 *   FIX-4: db-init.ts — no synchronous busy-wait spin loop
 *   FIX-5: telemetry-reporter.ts — mkdirSync before writeFile
 *   FIX-6: rules.ts — resolvePaths(opts.workDir) not getPaths()
 *   FIX-7: chat.ts — 100KB/message and 10MB/conversation size limits
 *   FIX-8: start.ts — "API key file:" label, not "API key:"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs   from "node:fs";
import path from "node:path";
import os   from "node:os";

// ===========================================================================
// FIX-1: formatJson — output must always be parseable JSON
// ===========================================================================

describe("P252 FIX-1: formatJson always produces valid JSON", () => {
  it("returns valid JSON that JSON.parse accepts without throwing", async () => {
    const { formatJson } = await import("../../src/cli/formatters/json.js");
    const data = { hello: "world", nested: { a: 1 } };
    const result = formatJson(data);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("handles circular references and still returns valid JSON", async () => {
    const { formatJson } = await import("../../src/cli/formatters/json.js");
    const obj: Record<string, unknown> = { a: 1 };
    obj["self"] = obj; // circular
    const result = formatJson(obj);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("truncated output is valid JSON with truncated=true and partial field", async () => {
    const { formatJson } = await import("../../src/cli/formatters/json.js");

    // Produce output larger than 10 MiB by using a huge string
    const bigStr = "x".repeat(11 * 1024 * 1024);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const result = formatJson({ data: bigStr });
      // Must be parseable
      const parsed = JSON.parse(result) as Record<string, unknown>;
      expect(parsed["truncated"]).toBe(true);
      expect(typeof parsed["partial"]).toBe("string");
      expect(typeof parsed["note"]).toBe("string");
      // stderr must warn about truncation
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

// ===========================================================================
// FIX-2: email.ts — no require() in ESM module
// ===========================================================================

describe("P252 FIX-2: email.ts uses ESM imports (no require)", () => {
  it("email.ts source does not contain require()", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/email.ts"),
      "utf-8",
    );
    // Should not have any require( calls (CommonJS interop in ESM)
    expect(content).not.toContain("require(");
  });

  it("email.ts imports readFileSync from node:fs at the top level", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/email.ts"),
      "utf-8",
    );
    // ESM import for readFileSync must exist
    expect(content).toMatch(/import\s.*readFileSync.*from\s+["']node:fs["']/);
  });
});

// ===========================================================================
// FIX-3: migrate-embeddings — requires --experimental flag
// ===========================================================================

describe("P252 FIX-3: migrate-embeddings requires --experimental flag", () => {
  it("migrate-embeddings.ts source contains experimental guard", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/migrate-embeddings.ts"),
      "utf-8",
    );
    expect(content).toContain("--experimental");
    expect(content).toContain("experimental");
    // The guard should exit when flag is absent
    expect(content).toContain("process.exit(1)");
  });

  it("migrate-embeddings.ts guard (opts.experimental) appears before engine construction in action body", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/migrate-embeddings.ts"),
      "utf-8",
    );
    // Look for the guard check (inside the action handler) and the engine
    // construction — both are in the action body, guard must come first.
    const guardIdx  = content.indexOf("!opts.experimental");
    const engineIdx = content.indexOf("new EmbeddingMigrationEngine");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(engineIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(engineIdx);
  });
});

// ===========================================================================
// FIX-4: db-init.ts — no synchronous busy-wait spin loop
// ===========================================================================

describe("P252 FIX-4: db-init.ts has no synchronous spin loop", () => {
  it("db-init.ts does not contain a busy-wait spin loop pattern", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/utils/db-init.ts"),
      "utf-8",
    );
    // The spin loop pattern: while (Date.now() < deadline)
    expect(content).not.toContain("while (Date.now() < deadline)");
    // No spin variable
    expect(content).not.toMatch(/const deadline = Date\.now\(\) \+ \d+/);
  });

  it("db-init.ts retains the retry logic without the spin", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/utils/db-init.ts"),
      "utf-8",
    );
    // Retry must still exist (two applySchema calls)
    const callCount = (content.match(/applySchema\(\)/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("db-init.ts comment no longer claims 500ms delay", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/utils/db-init.ts"),
      "utf-8",
    );
    // The misleading "500ms" must be gone
    expect(content).not.toContain("retrying once in 500ms");
    expect(content).not.toContain("500 ms");
  });
});

// ===========================================================================
// FIX-5: telemetry-reporter.ts — mkdirSync before writeFile
// ===========================================================================

describe("P252 FIX-5: telemetry-reporter creates parent directory before write", () => {
  it("saveTelemetryConfig creates the telemetry directory if absent", async () => {
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), "sidjua-p252-"));
    // Use a nested path that does not exist yet
    const workDir = path.join(tmpDir, "nested", "workspace");

    try {
      const { saveTelemetryConfig } = await import("../../src/core/telemetry/telemetry-reporter.js");
      const cfg = {
        mode:                    "off" as const,
        primaryEndpoint:         "https://example.com",
        fallbackEndpoint:        "https://example2.com",
        installationId:          "test-id",
        installationIdCreatedAt: new Date().toISOString(),
      };
      // Should NOT throw even though parent dirs don't exist
      await expect(saveTelemetryConfig(workDir, cfg)).resolves.not.toThrow();
      // File must be written
      const cfgPath = path.join(workDir, ".system", "telemetry.json");
      expect(fs.existsSync(cfgPath)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("telemetry-reporter.ts source contains mkdirSync before writeFile", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/core/telemetry/telemetry-reporter.ts"),
      "utf-8",
    );
    expect(content).toContain("mkdirSync");
    // mkdirSync must appear before writeFile in the saveTelemetryConfig function
    const mkdirIdx    = content.indexOf("mkdirSync(dirname(cfgPath)");
    const writeFileIdx = content.indexOf("await writeFile(cfgPath");
    expect(mkdirIdx).toBeGreaterThan(-1);
    expect(writeFileIdx).toBeGreaterThan(-1);
    expect(mkdirIdx).toBeLessThan(writeFileIdx);
  });
});

// ===========================================================================
// FIX-6: rules.ts — resolvePaths(opts.workDir) not getPaths()
// ===========================================================================

describe("P252 FIX-6: rules.ts respects --work-dir via resolvePaths", () => {
  it("rules.ts does not call getPaths() (ignores --work-dir)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/rules.ts"),
      "utf-8",
    );
    // getPaths() ignores workDir — must not be used
    expect(content).not.toContain("getPaths()");
  });

  it("rules.ts calls resolvePaths(opts.workDir) to honour --work-dir", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/rules.ts"),
      "utf-8",
    );
    expect(content).toContain("resolvePaths(opts.workDir)");
    expect(content).toContain("resolvePaths");
  });
});

// ===========================================================================
// FIX-7: chat.ts — message and conversation size limits
// ===========================================================================

describe("P252 FIX-7: chat.ts enforces message and conversation size limits", () => {
  it("chat.ts source contains 100 KiB per-message limit", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/api/routes/chat.ts"),
      "utf-8",
    );
    expect(content).toContain("MAX_MESSAGE_BYTES");
    expect(content).toContain("100 * 1024");
    expect(content).toContain("413");
  });

  it("chat.ts source contains 10 MiB per-conversation limit", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/api/routes/chat.ts"),
      "utf-8",
    );
    expect(content).toContain("MAX_CONVERSATION_BYTES");
    expect(content).toContain("10 * 1024 * 1024");
  });

  it("chat.ts reads raw body text before JSON.parse (not c.req.json)", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/api/routes/chat.ts"),
      "utf-8",
    );
    // Must use c.req.text() for size check, then JSON.parse manually
    expect(content).toContain("c.req.text()");
    expect(content).toContain("JSON.parse(rawBody)");
    // Should no longer call c.req.json() inside the POST handler body
    // (the size check replaces that call)
    const postHandlerIdx = content.indexOf("app.post");
    const reqJsonIdx     = content.indexOf("c.req.json", postHandlerIdx);
    expect(reqJsonIdx).toBe(-1);
  });
});

// ===========================================================================
// FIX-8: start.ts — "API key file:" label, not "API key:"
// ===========================================================================

describe("P252 FIX-8: start.ts uses clear label for API key file path", () => {
  it("start.ts output labels the key path as 'API key file:' not 'API key:'", () => {
    const content = fs.readFileSync(
      path.join(process.cwd(), "src/cli/commands/start.ts"),
      "utf-8",
    );
    // Must use unambiguous label
    expect(content).toContain("API key file:");
    // The ambiguous bare "API key:" (without "file") must not appear for the path output
    const lines = content.split("\n");
    const ambiguous = lines.filter(
      (l) => l.includes("API key:") && !l.includes("API key file:") && l.includes("keyFile"),
    );
    expect(ambiguous).toHaveLength(0);
  });
});
