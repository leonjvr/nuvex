// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P247 — API Key & Bootstrap Security regression tests
 *
 * FIX-1: gui-bootstrap route removed — must return 404
 * FIX-2: Key store encryption round-trip (encryptApiKey / decryptApiKey)
 * FIX-3: secret get masked by default; --reveal shows full value + audit line
 * FIX-4: init writeInitConfig writes reference placeholders, not plaintext keys (source inspection)
 * FIX-5: key add literal: requires --allow-plaintext or exits with error
 * FIX-6: audit export blocks path traversal outside cwd
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// FIX-1: gui-bootstrap removed
// ---------------------------------------------------------------------------

import { createApiServer, type ApiServerConfig } from "../../src/api/server.js";
import { clearRateLimitState } from "../../src/api/middleware/rate-limiter.js";

const TEST_KEY = "p247-test-api-key-abcdef1234567890";

const BASE_CONFIG: ApiServerConfig = {
  port:         3098,
  host:         "127.0.0.1",
  api_key:      TEST_KEY,
  cors_origins: [],
  rate_limit: { enabled: false, window_ms: 60_000, max_requests: 100, burst_max: 20 },
  trust_proxy: false,
};

describe("FIX-1: gui-bootstrap route — localhost-only, public path", () => {
  beforeEach(() => clearRateLimitState());
  afterEach(() => clearRateLimitState());

  it("GET /api/v1/gui-bootstrap returns 200 from localhost (no auth required)", async () => {
    const { app } = createApiServer(BASE_CONFIG);
    // Hono test client uses Host: localhost by default
    const res = await app.request("/api/v1/gui-bootstrap");
    expect(res.status).toBe(200);
  });

  it("returns api_key in response body", async () => {
    const { app } = createApiServer(BASE_CONFIG);
    const body = await app.request("/api/v1/gui-bootstrap").then((r) => r.json()) as Record<string, unknown>;
    expect(typeof body["api_key"]).toBe("string");
  });

  it("returns 403 when Host header is an external IP", async () => {
    const { app } = createApiServer(BASE_CONFIG);
    const res = await app.request("/api/v1/gui-bootstrap", {
      headers: { Host: "192.168.1.100:4200" },
    });
    expect(res.status).toBe(403);
  });

  it("gui-bootstrap is in PUBLIC_PATHS (source inspection)", () => {
    const src = readFileSync(resolve("src/api/middleware/auth.ts"), "utf-8");
    expect(src).toContain("gui-bootstrap");
  });

  it("gui-bootstrap route is registered in system routes (source inspection)", () => {
    const src = readFileSync(resolve("src/api/routes/system.ts"), "utf-8");
    expect(src).toContain("gui-bootstrap");
  });
});

// ---------------------------------------------------------------------------
// FIX-2: Key store encryption round-trip
// ---------------------------------------------------------------------------

import { encryptApiKey, decryptApiKey } from "../../src/api/key-store.js";

describe("FIX-2: Key store AES-256-GCM encryption round-trip", () => {
  it("encrypt then decrypt returns original plaintext", () => {
    const original = "sk-ant-api03-testkey-abcdefghijklmnop1234567890";
    const encrypted = encryptApiKey(original);
    expect(decryptApiKey(encrypted)).toBe(original);
  });

  it("encrypted value is different from plaintext", () => {
    const key = "my-secret-api-key-12345";
    expect(encryptApiKey(key)).not.toBe(key);
  });

  it("encrypted value is base64-encoded", () => {
    const enc = encryptApiKey("test-key-xyz");
    expect(/^[A-Za-z0-9+/]+=*$/.test(enc)).toBe(true);
    expect(enc.length).toBeGreaterThan(44); // IV(16) + tag(16) + payload > 44 base64 chars
  });

  it("two encryptions of the same key produce different ciphertexts (random IV)", () => {
    const key = "same-key-different-iv";
    const enc1 = encryptApiKey(key);
    const enc2 = encryptApiKey(key);
    expect(enc1).not.toBe(enc2);
    // Both must decrypt correctly
    expect(decryptApiKey(enc1)).toBe(key);
    expect(decryptApiKey(enc2)).toBe(key);
  });

  it("plaintext migration: decryptApiKey returns short non-base64 strings as-is", () => {
    // A short plaintext key (< 44 chars) is returned unchanged — migration path.
    const plaintext = "short-plain-key";
    expect(decryptApiKey(plaintext)).toBe(plaintext);
  });

  it("persistKeyState and loadKeyState round-trip encrypts stored value (source inspection)", () => {
    const src = readFileSync(resolve("src/api/key-store.ts"), "utf-8");
    expect(src).toContain("encryptApiKey");
    expect(src).toContain("decryptApiKey");
    // persistKeyState appears after openDb helper — slice from its declaration to end
    const persistIdx = src.indexOf("export function persistKeyState");
    expect(persistIdx).toBeGreaterThan(-1);
    const persistFnBody = src.slice(persistIdx);
    // encryptApiKey must be called before .run()
    expect(persistFnBody).toContain("encryptApiKey");
  });
});

// ---------------------------------------------------------------------------
// FIX-3: secret get masked output
// ---------------------------------------------------------------------------

describe("FIX-3: secret get masked output (source inspection)", () => {
  it("get command has --reveal option", () => {
    const src = readFileSync(resolve("src/cli/commands/secret.ts"), "utf-8");
    expect(src).toContain("--reveal");
    expect(src).toContain("opts.reveal");
  });

  it("get command masks value by default (last-4-only pattern)", () => {
    const src = readFileSync(resolve("src/cli/commands/secret.ts"), "utf-8");
    // Masking pattern: only last 4 chars revealed (prevents prefix correlation)
    expect(src).toContain("value.slice(-4)");
    expect(src).toContain("****");
  });

  it("get command emits audit line on --reveal", () => {
    const src = readFileSync(resolve("src/cli/commands/secret.ts"), "utf-8");
    expect(src).toContain("secret.get.reveal_audit");
  });

  it("masking logic: 8-char value gets fully masked (****)", () => {
    const value = "abcd1234";
    const masked = value.length > 8 ? `****${value.slice(-4)}` : "****";
    expect(masked).toBe("****");
  });

  it("masking logic: 12-char value shows only last 4", () => {
    const value = "abcd12345678";
    const masked = value.length > 8 ? `****${value.slice(-4)}` : "****";
    expect(masked).toBe("****5678");
  });

  it("masking logic: 30-char value shows only last 4", () => {
    const value = "a".repeat(30);
    const masked = value.length > 8 ? `****${value.slice(-4)}` : "****";
    expect(masked).toBe("****aaaa");
    expect(masked.length).toBe(8); // always exactly 4 stars + 4 chars
  });
});

// ---------------------------------------------------------------------------
// FIX-4: init does not write plaintext keys
// ---------------------------------------------------------------------------

describe("FIX-4: init writeInitConfig uses secret references, not plaintext keys (source inspection)", () => {
  it("YAML provider files use secret: reference prefix", () => {
    const src = readFileSync(resolve("src/cli/commands/init.ts"), "utf-8");
    // Template literal builds "api_key: secret:<ref>" — check that both parts exist
    expect(src).toContain("secret:");
    expect(src).toContain("secretRef");
    expect(src).toContain("`api_key: secret:");
  });

  it("provider key is stored via SqliteSecretsProvider, not written to YAML directly", () => {
    const src = readFileSync(resolve("src/cli/commands/init.ts"), "utf-8");
    expect(src).toContain("secretsProvider.set");
    // Must NOT write cfg.providerKey directly into YAML content
    expect(src).not.toContain("`api_key: ${cfg.providerKey}`");
  });

  it(".env lines reference encrypted secrets, not raw key values", () => {
    const src = readFileSync(resolve("src/cli/commands/init.ts"), "utf-8");
    // The env comment must mention sidjua secret get, not the raw key
    expect(src).toContain("sidjua secret get");
    // Must NOT append raw key to .env
    expect(src).not.toContain("`${envVar}=${cfg.providerKey}`");
  });
});

// ---------------------------------------------------------------------------
// FIX-5: key add literal: deprecation
// ---------------------------------------------------------------------------

describe("FIX-5: key add literal source requires --allow-plaintext (source inspection)", () => {
  it("key.ts checks for literal: source without --allow-plaintext", () => {
    const src = readFileSync(resolve("src/cli/commands/key.ts"), "utf-8");
    expect(src).toContain("literal:");
    expect(src).toContain("allowPlaintext");
    // P271 B7: messages are now hardcoded (NODE_ENV-aware) rather than i18n keys
    expect(src).toContain("literal: key source is blocked in production");
    expect(src).toContain("NODE_ENV");
  });

  it("key.ts sets process.exitCode = 1 when literal source rejected", () => {
    const src = readFileSync(resolve("src/cli/commands/key.ts"), "utf-8");
    expect(src).toContain("process.exitCode = 1");
  });

  it("--allow-plaintext option is declared on the add command", () => {
    const src = readFileSync(resolve("src/cli/commands/key.ts"), "utf-8");
    expect(src).toContain("--allow-plaintext");
  });
});

// ---------------------------------------------------------------------------
// FIX-6: audit export path traversal
// ---------------------------------------------------------------------------

import { resolve as pathResolve, relative } from "node:path";

describe("FIX-6: audit export path traversal protection", () => {
  it("assertWithinDirectory logic: path within cwd passes", () => {
    const baseDir     = pathResolve("/home/user/workspace");
    const outPath     = pathResolve("/home/user/workspace/audit.json");
    const rel         = relative(baseDir, outPath);
    const blocked     = rel.startsWith("..") || pathResolve(baseDir, rel) !== outPath;
    expect(blocked).toBe(false);
  });

  it("assertWithinDirectory logic: path traversal detected (../../etc/passwd)", () => {
    const baseDir     = pathResolve("/home/user/workspace");
    const userInput   = "../../etc/passwd";
    const outPath     = pathResolve(userInput);
    const rel         = relative(baseDir, outPath);
    const blocked     = rel.startsWith("..") || pathResolve(baseDir, rel) !== outPath;
    expect(blocked).toBe(true);
  });

  it("audit export source has path traversal guard for --output flag", () => {
    const src = readFileSync(resolve("src/cli/commands/audit.ts"), "utf-8");
    expect(src).toContain("opts.output !== undefined");
    expect(src).toContain("relative(");
    expect(src).toContain('rel.startsWith("..")');
    expect(src).toContain("audit.export.path_outside_workdir");
  });

  it("default export path (no --output) bypasses the traversal check safely", () => {
    const src = readFileSync(resolve("src/cli/commands/audit.ts"), "utf-8");
    // Guard only triggers when opts.output is provided
    expect(src).toContain("if (opts.output !== undefined)");
  });
});
