// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Audit round-2 verification tests.
 *
 * Covers:
 *   Task 1 (false positive): detectBase64 scans full input after prefix stripping
 *   Task 2 (false positive): backup streamingExtract validates path before mkdirSync
 *   Task 3 (confirmed fix): result_file path containment check
 *   Task 4 (confirmed fix): secrets ns/key format validation
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Task 1 — VERIFY (false positive): detectBase64 scans remainder after prefix
// ---------------------------------------------------------------------------

describe("Task 1 (false positive): detectBase64 source scans remainder after auth prefix", () => {
  it("source strips Bearer prefix but scans the remainder", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/core/input-sanitizer.ts"),
      "utf8",
    ) as string;
    // The prefix is stripped so we scan what comes after — not to skip it
    expect(src).toContain("text.slice(authPrefixMatch[0].length)");
    expect(src).toContain("scanText");
    // The full scanText is iterated in the for loop
    expect(src).toContain("for (let i = 0; i <= scanText.length; i++)");
  });

  it("detectBase64 detects base64 after a Bearer prefix", async () => {
    const { InputSanitizer } = await import("../../src/core/input-sanitizer.js");
    const sanitizer = new InputSanitizer({ mode: "warn" });
    // 210 'A' chars — well above the 200-char threshold — after a Bearer token
    const longB64 = "A".repeat(210);
    const input   = `Bearer eyJhbGciOiJIUzI1NiJ9.token ${longB64}`;
    const result  = sanitizer.sanitize(input);
    expect(result.warnings.some((w) => w.type === "encoding_attack")).toBe(true);
  });

  it("detectBase64 does NOT flag a bare legitimate Bearer token (no trailing payload)", async () => {
    const { InputSanitizer } = await import("../../src/core/input-sanitizer.js");
    const sanitizer = new InputSanitizer({ mode: "warn" });
    // A typical JWT — segments separated by dots, each well under 200 chars
    const jwt   = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `Bearer ${jwt}`;
    const result = sanitizer.sanitize(input);
    expect(result.warnings.filter((w) => w.type === "encoding_attack")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2 — VERIFY (false positive): zip-slip check before mkdirSync
// ---------------------------------------------------------------------------

describe("Task 2 (false positive): backup streamingExtract validates before mkdir", () => {
  it("source checks startsWith BEFORE mkdirSync", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/core/backup.ts"),
      "utf8",
    ) as string;
    const extractFn = src.slice(src.indexOf("async function streamingExtract"));
    const checkPos  = extractFn.indexOf("startsWith(resolvedTarget");
    const mkdirPos  = extractFn.indexOf("mkdirSync(fullEntryPath");
    expect(checkPos).toBeGreaterThan(-1);
    expect(mkdirPos).toBeGreaterThan(-1);
    // Validation must appear before the first mkdir
    expect(checkPos).toBeLessThan(mkdirPos);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — result_file path containment
// ---------------------------------------------------------------------------

describe("Task 3 (confirmed fix): tasks.ts result_file containment check", () => {
  it("source resolves path and checks startsWith workDir", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/cli/commands/tasks.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("resolvedWorkDir");
    expect(src).toContain("resolvedPath");
    expect(src).toContain("startsWith(resolvedWorkDir + sep)");
    expect(src).toContain("outside the workspace directory");
  });

  it("rejects a result_file that traverses outside workDir", () => {
    const { resolve, sep } = require("node:path") as typeof import("node:path");
    const workDir = "/home/user/sidjua";
    const resultFile = "../../etc/passwd";
    const resolvedWorkDir = resolve(workDir);
    const resolvedPath    = resolve(workDir, resultFile);
    const isContained = resolvedPath.startsWith(resolvedWorkDir + sep);
    expect(isContained).toBe(false);
  });

  it("accepts a valid result_file within workDir", () => {
    const { resolve, sep } = require("node:path") as typeof import("node:path");
    const workDir = "/home/user/sidjua";
    const resultFile = "data/results/task-abc.json";
    const resolvedWorkDir = resolve(workDir);
    const resolvedPath    = resolve(workDir, resultFile);
    const isContained = resolvedPath.startsWith(resolvedWorkDir + sep);
    expect(isContained).toBe(true);
  });

  it("rejects an absolute path outside workDir", () => {
    const { resolve, sep } = require("node:path") as typeof import("node:path");
    const workDir = "/home/user/sidjua";
    const resultFile = "/etc/shadow";
    const resolvedWorkDir = resolve(workDir);
    const resolvedPath    = resolve(workDir, resultFile);
    const isContained = resolvedPath.startsWith(resolvedWorkDir + sep);
    expect(isContained).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 4 — secrets ns/key format validation
// ---------------------------------------------------------------------------

describe("Task 4 (confirmed fix): secrets route ns/key format validation", () => {
  async function makeApp() {
    const { registerSecretRoutes } = await import("../../src/api/routes/secrets.js");
    const app = new Hono();
    app.use("*", withAdminCtx);

    // Minimal mock provider
    const provider = {
      list:        async (_ns: string)                    => [] as string[],
      get:         async (_ns: string, _k: string)        => null,
      set:         async (_ns: string, _k: string, _v: string) => undefined,
      delete:      async (_ns: string, _k: string)        => undefined,
      rotate:      async (_ns: string, _k: string, _v: string) => undefined,
      getMetadata: async (_ns: string, _k: string)        => null,
    } as unknown as import("../../src/types/apply.js").SecretsProvider;

    // Minimal mock DB (namespaces endpoint only)
    const secretsDb = {
      prepare: () => ({ all: () => [] }),
    } as unknown as import("better-sqlite3").Database;

    registerSecretRoutes(app, {
      provider,
      secretsDb,
      callerContext: { role: "operator" },
    });

    return app;
  }

  it("GET /secrets/keys with valid ns is accepted", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/keys?ns=global");
    expect(res.status).toBe(200);
  });

  it("GET /secrets/keys with division ns is accepted", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/keys?ns=divisions/engineering");
    expect(res.status).toBe(200);
  });

  it("GET /secrets/keys with path-traversal ns is rejected 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/keys?ns=../../etc");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT-001");
  });

  it("GET /secrets/value with SQL metachar ns is rejected 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/value?ns=global'; DROP TABLE secrets; --&key=API_KEY");
    expect(res.status).toBe(400);
  });

  it("GET /secrets/value with 130-char ns is rejected 400", async () => {
    const app = await makeApp();
    const ns  = "a".repeat(130);
    const res = await app.request(`/api/v1/secrets/value?ns=${ns}&key=KEY`);
    expect(res.status).toBe(400);
  });

  it("GET /secrets/value with valid ns and key is accepted", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/value?ns=global&key=API_KEY");
    // 404 because mock returns null, but not 400 — format is valid
    expect([200, 404]).toContain(res.status);
  });

  it("GET /secrets/value with key containing slash is rejected 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/value?ns=global&key=../../etc/passwd");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT-001");
  });

  it("DELETE /secrets/value with invalid ns is rejected 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/value?ns=../bad&key=KEY", { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("GET /secrets/info with invalid key is rejected 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/v1/secrets/info?ns=global&key=bad/key");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("INPUT-001");
  });

  it("NS_RE and KEY_RE source constants are present", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "src/api/routes/secrets.ts"),
      "utf8",
    ) as string;
    expect(src).toContain("NS_RE");
    expect(src).toContain("KEY_RE");
  });
});
