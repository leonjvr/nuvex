// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/sandbox/sandbox-factory.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sandbox-runtime so BubblewrapProvider import succeeds
// without real bwrap binaries.
// ---------------------------------------------------------------------------

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize:               vi.fn().mockResolvedValue(undefined),
    reset:                    vi.fn().mockResolvedValue(undefined),
    checkDependencies:        vi.fn().mockReturnValue({ errors: [], warnings: [] }),
    getProxyPort:             vi.fn().mockReturnValue(9000),
    getSocksProxyPort:        vi.fn().mockReturnValue(9001),
    wrapWithSandbox:          vi.fn().mockResolvedValue("wrapped"),
    getSandboxViolationStore: vi.fn().mockReturnValue({ subscribe: vi.fn().mockReturnValue(() => {}) }),
  },
}));

import {
  createSandboxProvider,
  DEFAULT_SANDBOX_CONFIG,
} from "../../../src/core/sandbox/sandbox-factory.js";
import { NoSandboxProvider }   from "../../../src/core/sandbox/no-sandbox-provider.js";
import { BubblewrapProvider }  from "../../../src/core/sandbox/bubblewrap-provider.js";
import type { SandboxConfig }  from "../../../src/core/sandbox/types.js";

const BASE_DEFAULTS = DEFAULT_SANDBOX_CONFIG.defaults;

describe("createSandboxProvider", () => {
  // FIX-3: provider "none" now requires SIDJUA_ALLOW_NO_SANDBOX=true
  beforeEach(() => { vi.stubEnv("SIDJUA_ALLOW_NO_SANDBOX", "true"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns NoSandboxProvider for provider 'none'", () => {
    const config: SandboxConfig = { provider: "none", defaults: BASE_DEFAULTS };
    const provider = createSandboxProvider(config);
    expect(provider).toBeInstanceOf(NoSandboxProvider);
    expect(provider.name).toBe("none");
  });

  it("returns BubblewrapProvider for provider 'bubblewrap'", () => {
    const config: SandboxConfig = { provider: "bubblewrap", defaults: BASE_DEFAULTS };
    const provider = createSandboxProvider(config);
    expect(provider).toBeInstanceOf(BubblewrapProvider);
    expect(provider.name).toBe("bubblewrap");
  });

  it("returned provider is not yet initialized", () => {
    const config: SandboxConfig = { provider: "none", defaults: BASE_DEFAULTS };
    const provider = createSandboxProvider(config);
    expect(provider.initialized).toBe(false);
  });

  it("returned BubblewrapProvider is not yet initialized", () => {
    const config: SandboxConfig = { provider: "bubblewrap", defaults: BASE_DEFAULTS };
    const provider = createSandboxProvider(config);
    expect(provider.initialized).toBe(false);
  });

  it("returned provider can be initialized", async () => {
    const config: SandboxConfig = { provider: "none", defaults: BASE_DEFAULTS };
    const provider = createSandboxProvider(config);
    await provider.initialize();
    expect(provider.initialized).toBe(true);
  });
});

describe("DEFAULT_SANDBOX_CONFIG", () => {
  it("has provider 'none'", () => {
    expect(DEFAULT_SANDBOX_CONFIG.provider).toBe("none");
  });

  it("has empty allowedDomains and deniedDomains", () => {
    expect(DEFAULT_SANDBOX_CONFIG.defaults.network.allowedDomains).toEqual([]);
    expect(DEFAULT_SANDBOX_CONFIG.defaults.network.deniedDomains).toEqual([]);
  });

  it("denies read on sensitive paths by default", () => {
    const { denyRead } = DEFAULT_SANDBOX_CONFIG.defaults.filesystem;
    expect(denyRead).toContain("~/.ssh");
    expect(denyRead).toContain("~/.gnupg");
    expect(denyRead).toContain("/etc/shadow");
  });

  it("has empty allowWrite and denyWrite by default", () => {
    expect(DEFAULT_SANDBOX_CONFIG.defaults.filesystem.allowWrite).toEqual([]);
    expect(DEFAULT_SANDBOX_CONFIG.defaults.filesystem.denyWrite).toEqual([]);
  });

  it("has expected shape (all required fields present)", () => {
    const c = DEFAULT_SANDBOX_CONFIG;
    expect(c.provider).toBeDefined();
    expect(c.defaults.network).toBeDefined();
    expect(c.defaults.filesystem).toBeDefined();
    expect(Array.isArray(c.defaults.network.allowedDomains)).toBe(true);
    expect(Array.isArray(c.defaults.network.deniedDomains)).toBe(true);
    expect(Array.isArray(c.defaults.filesystem.denyRead)).toBe(true);
    expect(Array.isArray(c.defaults.filesystem.allowWrite)).toBe(true);
    expect(Array.isArray(c.defaults.filesystem.denyWrite)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FIX-H2: Fail-secure factory — unknown provider throws instead of falling back
// ---------------------------------------------------------------------------

import { SidjuaError } from "../../../src/core/error-codes.js";

describe("createSandboxProvider — FIX-H2 fail-secure", () => {
  it("throws SidjuaError (SYS-003) for an unknown provider string", () => {
    const config = { provider: "docker" as "none", defaults: BASE_DEFAULTS };
    expect(() => createSandboxProvider(config)).toThrow(SidjuaError);
  });

  it("error message mentions the unknown provider name", () => {
    const config = { provider: "invalid-xyz" as "none", defaults: BASE_DEFAULTS };
    let caught: unknown;
    try { createSandboxProvider(config); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(SidjuaError);
    const err = caught as SidjuaError;
    expect(err.message).toContain("invalid-xyz");
    expect(err.code).toBe("SYS-003");
  });

  it("does NOT return NoSandboxProvider as a silent fallback", () => {
    const config = { provider: "unknown-thing" as "none", defaults: BASE_DEFAULTS };
    expect(() => createSandboxProvider(config)).toThrow();
    // Verify it's an error, not a silently returned instance
  });
});
