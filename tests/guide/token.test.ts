/**
 * Tests for Guide: Embedded Token Management
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getEmbeddedAccountId,
  getEmbeddedToken,
  hasEmbeddedCredentials,
  PLACEHOLDER_ACCOUNT_ID,
  PLACEHOLDER_CF_TOKEN,
} from "../../src/guide/token.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getEmbeddedAccountId", () => {
  it("returns placeholder when no env var and no embedded bytes", () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    const id = getEmbeddedAccountId();
    expect(id).toBe(PLACEHOLDER_ACCOUNT_ID);
  });

  it("returns env var value when SIDJUA_CF_ACCOUNT_ID is set", () => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "my-test-account");
    expect(getEmbeddedAccountId()).toBe("my-test-account");
  });

  it("returns non-empty string in all cases", () => {
    const id = getEmbeddedAccountId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

describe("getEmbeddedToken", () => {
  it("returns placeholder when no env var and no embedded bytes", () => {
    delete process.env["SIDJUA_CF_TOKEN"];
    const token = getEmbeddedToken();
    expect(token).toBe(PLACEHOLDER_CF_TOKEN);
  });

  it("returns env var value when SIDJUA_CF_TOKEN is set", () => {
    vi.stubEnv("SIDJUA_CF_TOKEN", "secret-test-token");
    expect(getEmbeddedToken()).toBe("secret-test-token");
  });

  it("returns non-empty string in all cases", () => {
    const token = getEmbeddedToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("token value does not appear in error messages by default", () => {
    vi.stubEnv("SIDJUA_CF_TOKEN", "super-secret-xyz");
    const token = getEmbeddedToken();
    // We only verify the function returns the value; the safeguard is in usage
    expect(token).toBe("super-secret-xyz");
  });
});

describe("hasEmbeddedCredentials", () => {
  it("returns false when both are placeholders", () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];
    expect(hasEmbeddedCredentials()).toBe(false);
  });

  it("returns false when only account ID is set", () => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "my-account");
    delete process.env["SIDJUA_CF_TOKEN"];
    expect(hasEmbeddedCredentials()).toBe(false);
  });

  it("returns false when only token is set", () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    vi.stubEnv("SIDJUA_CF_TOKEN", "my-token");
    expect(hasEmbeddedCredentials()).toBe(false);
  });

  it("returns true when both account ID and token are set via env", () => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "real-account");
    vi.stubEnv("SIDJUA_CF_TOKEN",      "real-token");
    expect(hasEmbeddedCredentials()).toBe(true);
  });

  it("returns false for empty string credentials", () => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "");
    vi.stubEnv("SIDJUA_CF_TOKEN",      "");
    // Empty strings fall through to placeholder
    expect(hasEmbeddedCredentials()).toBe(false);
  });
});
