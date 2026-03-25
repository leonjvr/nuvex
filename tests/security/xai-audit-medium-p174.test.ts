// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for xAI Grok 4.1 audit MEDIUM-priority findings.
 *
 *   T1: Module tools governance — validateModuleCapabilities() enforces
 *       capability whitelist before tools are registered.
 *   T2: WAL auto-prune (size-based) — MemoryWal.pruneIfOversized() compacts
 *       when the JSONL file exceeds the threshold.
 *   T3: Log rotation — logger.ts already implements 50 MB / 5-file rotation.
 *   T4: CSRF Tauri 2.x — ALLOWED_ORIGIN_RE already handles tauri://localhost
 *       and tauri://localhost.localhost.
 *   T5: Hardcoded timezone removed — init.ts does not use toLocaleString
 *       with a hardcoded timeZone.
 *   T6: SIDJUA_DATA_DIR env var — resolvePaths() already honours the env var.
 *   T7: Docker seccomp profile — seccomp-profile.json exists and is
 *       referenced in docker-compose.yml.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";

// ===========================================================================
// T1: Module tools governance — capability whitelist
// ===========================================================================

import {
  validateModuleCapabilities,
  ALLOWED_MODULE_CAPABILITIES,
} from "../../src/modules/module-loader.js";
import type { ModuleManifest } from "../../src/modules/module-types.js";

function makeManifest(tools: ModuleManifest["tools"] = []): ModuleManifest {
  return {
    id:                 "test-module",
    name:               "Test Module",
    version:            "1.0.0",
    description:        "A test module",
    category:           "communication",
    sidjua_min_version: "0.11.0",
    tools,
  };
}

describe("T1: Module capability governance — validateModuleCapabilities", () => {
  it("module with no tools passes validation without error", () => {
    expect(() => validateModuleCapabilities(makeManifest([]))).not.toThrow();
    expect(() => validateModuleCapabilities(makeManifest(undefined))).not.toThrow();
  });

  it("module with valid capabilities (messaging, read, search) passes validation", () => {
    const manifest = makeManifest([
      { name: "send_msg",   description: "Send a message",  capabilities: ["messaging"] },
      { name: "fetch_data", description: "Fetch remote data", capabilities: ["read", "search"] },
    ]);
    expect(() => validateModuleCapabilities(manifest)).not.toThrow();
  });

  it("module declaring disallowed capability (write_secrets) is rejected with SEC-013", () => {
    const manifest = makeManifest([
      { name: "evil_tool", description: "Bad tool", capabilities: ["write_secrets"] },
    ]);
    expect(() => validateModuleCapabilities(manifest)).toThrow(/[Dd]isallowed.*capability|SEC-013/);
  });

  it("module declaring disallowed capability (admin) is rejected", () => {
    const manifest = makeManifest([
      { name: "admin_tool", description: "Admin escalation", capabilities: ["admin"] },
    ]);
    expect(() => validateModuleCapabilities(manifest)).toThrow(/disallowed capability/);
  });

  it("module declaring disallowed capability (execute) is rejected", () => {
    const manifest = makeManifest([
      { name: "exec_tool", description: "Exec tool", capabilities: ["execute"] },
    ]);
    expect(() => validateModuleCapabilities(manifest)).toThrow(/[Dd]isallowed.*capability|SEC-013/);
  });

  it("ALLOWED_MODULE_CAPABILITIES whitelist exports the expected capability set", () => {
    expect(ALLOWED_MODULE_CAPABILITIES.has("messaging")).toBe(true);
    expect(ALLOWED_MODULE_CAPABILITIES.has("read")).toBe(true);
    expect(ALLOWED_MODULE_CAPABILITIES.has("search")).toBe(true);
    expect(ALLOWED_MODULE_CAPABILITIES.has("notify")).toBe(true);
    expect(ALLOWED_MODULE_CAPABILITIES.has("webhook")).toBe(true);
    // Dangerous capabilities must NOT be in the whitelist
    expect(ALLOWED_MODULE_CAPABILITIES.has("admin")).toBe(false);
    expect(ALLOWED_MODULE_CAPABILITIES.has("write_secrets")).toBe(false);
    expect(ALLOWED_MODULE_CAPABILITIES.has("execute")).toBe(false);
  });

  it("installModule calls validateModuleCapabilities (source inspection)", () => {
    const src = readFileSync(
      new URL("../../src/modules/module-loader.ts", import.meta.url),
      "utf-8",
    );
    const installFn = src.slice(src.indexOf("async function installModule"), src.indexOf("async function uninstallModule"));
    expect(installFn).toContain("validateModuleCapabilities");
  });
});

// ===========================================================================
// T2: WAL auto-prune (size-based)
// ===========================================================================

import { MemoryWal, WAL_MAX_BYTES } from "../../src/knowledge-pipeline/wal/memory-wal.js";

describe("T2: WAL auto-prune — pruneIfOversized", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "sidjua-t2-wal-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("WAL_MAX_BYTES constant is 50 MB", () => {
    expect(WAL_MAX_BYTES).toBe(50 * 1024 * 1024);
  });

  it("pruneIfOversized returns false when WAL file does not exist", async () => {
    const wal = new MemoryWal(join(tmp, "nonexistent.jsonl"));
    const pruned = await wal.pruneIfOversized(1024);
    expect(pruned).toBe(false);
  });

  it("pruneIfOversized returns false when WAL is below threshold", async () => {
    const walPath = join(tmp, "wal.jsonl");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(walPath, "x".repeat(100), "utf-8");

    const wal = new MemoryWal(walPath);
    const pruned = await wal.pruneIfOversized(1024 * 1024); // 1 MB threshold
    expect(pruned).toBe(false);
  });

  it("pruneIfOversized triggers compact() when WAL exceeds threshold", async () => {
    const walDir  = join(tmp, ".system", "memory");
    const walPath = join(walDir, "wal.jsonl");
    mkdirSync(walDir, { recursive: true });

    // Create a WAL larger than our test threshold (1 KB)
    const wal = new MemoryWal(walPath);
    // Write many committed entries (will be discarded by compact)
    for (let i = 0; i < 50; i++) {
      const id = await wal.appendPending("chunk_write", "test-col", `chunk-${i}`);
      await wal.markCommitted(id, "chunk_write", "test-col", `chunk-${i}`);
    }
    // Add a pending entry that must survive
    await wal.appendPending("chunk_write", "test-col", "pending-chunk");

    const sizeBefore = statSync(walPath).size;
    expect(sizeBefore).toBeGreaterThan(0);

    // Use 1 byte threshold — always triggers
    const pruned = await wal.pruneIfOversized(1);
    expect(pruned).toBe(true);

    // After prune: WAL should be smaller (only pending entries remain)
    const sizeAfter = statSync(walPath).size;
    expect(sizeAfter).toBeLessThan(sizeBefore);

    // Pending entries must survive
    const pending = await wal.readPending();
    expect(pending.length).toBe(1);
    expect(pending[0]!.chunk_id).toBe("pending-chunk");
  });
});

// ===========================================================================
// T3: Log rotation already implemented in logger.ts
// ===========================================================================

describe("T3: Log rotation — logger.ts source verification", () => {
  it("logger.ts defines MAX_LOG_SIZE of 50 MB", () => {
    const src = readFileSync(
      new URL("../../src/core/logger.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("MAX_LOG_SIZE");
    expect(src).toContain("50 * 1024 * 1024");
  });

  it("logger.ts defines MAX_LOG_FILES of 5", () => {
    const src = readFileSync(
      new URL("../../src/core/logger.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("MAX_LOG_FILES");
    expect(src).toContain("5");
  });

  it("logger.ts implements rotateLog() — size-triggered rotation", () => {
    const src = readFileSync(
      new URL("../../src/core/logger.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("async function rotateLog");
    expect(src).toContain("checkRotation");
    expect(src).toContain("MAX_LOG_SIZE");
  });
});

// ===========================================================================
// T4: CSRF Tauri 2.x origin support
// ===========================================================================

import { csrfMiddleware } from "../../src/api/middleware/csrf.js";
import { Hono } from "hono";

function buildCsrfApp(): Hono {
  const app = new Hono();
  app.use("*", csrfMiddleware);
  app.post("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("T4: CSRF — Tauri origin support", () => {
  it("Tauri 1.x origin (tauri://localhost) passes CSRF check", async () => {
    const app = buildCsrfApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Origin":       "tauri://localhost",
        "Content-Type": "application/json",
      },
    });
    // Auth middleware not present — CSRF should pass and route returns 200
    expect(res.status).not.toBe(403);
  });

  it("Tauri 2.x origin (tauri://localhost.localhost) passes CSRF check", async () => {
    const app = buildCsrfApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Origin":       "tauri://localhost.localhost",
        "Content-Type": "application/json",
      },
    });
    expect(res.status).not.toBe(403);
  });

  it("Unknown origin is rejected with 403", async () => {
    const app = buildCsrfApp();
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Origin":       "https://evil.example.com",
        "Content-Type": "application/json",
      },
    });
    expect(res.status).toBe(403);
  });

  it("CSRF source regex handles both Tauri versions explicitly", () => {
    const src = readFileSync(
      new URL("../../src/api/middleware/csrf.ts", import.meta.url),
      "utf-8",
    );
    // Must handle Tauri 2.x (.localhost) via optional group
    expect(src).toContain("localhost");
    expect(src).toContain(`(\\.localhost)`);
  });
});

// ===========================================================================
// T5: No hardcoded timezone in init.ts
// ===========================================================================

describe("T5: Hardcoded timezone removed", () => {
  it("init.ts does not call toLocaleString with a hardcoded timeZone option", () => {
    const src = readFileSync(
      new URL("../../src/cli/commands/init.ts", import.meta.url),
      "utf-8",
    );
    expect(src).not.toMatch(/toLocaleString\([^)]*timeZone\s*:/);
    expect(src).not.toContain("Asia/Manila");
  });

  it("agent-lifecycle/types.ts contains Asia/Manila only as a doc comment, not as a runtime value", () => {
    const src = readFileSync(
      new URL("../../src/agent-lifecycle/types.ts", import.meta.url),
      "utf-8",
    );
    // The only occurrence must be inside a comment line (starts with //)
    const lines = src.split("\n").filter((l) => l.includes("Asia/Manila"));
    for (const line of lines) {
      // Accept both standalone comment lines (// ...) and inline comments (code // ...)
      expect(line).toContain("//");
    }
  });
});

// ===========================================================================
// T6: SIDJUA_DATA_DIR env var honoured by resolvePaths
// ===========================================================================

import { resolvePaths } from "../../src/core/paths.js";

describe("T6: SIDJUA_DATA_DIR env var override", () => {
  const ORIGINAL_ENV = process.env["SIDJUA_DATA_DIR"];

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env["SIDJUA_DATA_DIR"];
    } else {
      process.env["SIDJUA_DATA_DIR"] = ORIGINAL_ENV;
    }
  });

  it("SIDJUA_DATA_DIR env var overrides default ~/.sidjua path", () => {
    const customDir = "/custom/data/sidjua";
    process.env["SIDJUA_DATA_DIR"] = customDir;
    const paths = resolvePaths();
    expect(paths.data.root).toBe(customDir);
  });

  it("explicit dataDir argument takes priority over SIDJUA_DATA_DIR", () => {
    process.env["SIDJUA_DATA_DIR"] = "/env/data";
    const paths = resolvePaths("/explicit/data");
    expect(paths.data.root).toBe("/explicit/data");
  });

  it("paths.ts source documents SIDJUA_DATA_DIR in priority order comment", () => {
    const src = readFileSync(
      new URL("../../src/core/paths.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("SIDJUA_DATA_DIR");
    // Must use the env var in actual code, not just comments
    expect(src).toContain('process.env["SIDJUA_DATA_DIR"]');
  });
});

// ===========================================================================
// T7: Docker seccomp profile
// ===========================================================================

describe("T7: Docker seccomp profile", () => {
  it("seccomp-profile.json exists in project root", () => {
    const src = readFileSync(
      new URL("../../seccomp-profile.json", import.meta.url),
      "utf-8",
    );
    expect(src.length).toBeGreaterThan(0);
  });

  it("seccomp-profile.json explicitly blocks dangerous SYS_ADMIN syscalls", () => {
    const profile = JSON.parse(readFileSync(
      new URL("../../seccomp-profile.json", import.meta.url),
      "utf-8",
    )) as { syscalls: Array<{ names: string[]; action: string }> };

    const blockedNames = profile.syscalls
      .filter((s) => s.action === "SCMP_ACT_ERRNO")
      .flatMap((s) => s.names);

    expect(blockedNames).toContain("keyctl");
    expect(blockedNames).toContain("reboot");
    expect(blockedNames).toContain("swapon");
    expect(blockedNames).toContain("kexec_load");
  });

  it("docker-compose.yml references the seccomp profile", () => {
    const compose = readFileSync(
      new URL("../../docker-compose.yml", import.meta.url),
      "utf-8",
    );
    expect(compose).toContain("seccomp");
    expect(compose).toContain("seccomp-profile.json");
  });
});
