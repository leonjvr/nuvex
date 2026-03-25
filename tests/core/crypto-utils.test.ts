/**
 * Tests for src/core/crypto-utils.ts
 */

import { describe, it, expect } from "vitest";
import {
  timingSafeCompare,
  sha256hex,
  hmacSign,
  hmacVerify,
  timingSafeEqualBuffers,
  generateSecret,
} from "../../src/core/crypto-utils.js";

describe("timingSafeCompare", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeCompare("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(timingSafeCompare("hello", "world")).toBe(false);
  });

  it("returns false for different length strings", () => {
    expect(timingSafeCompare("short", "much longer string")).toBe(false);
  });

  it("returns false for empty vs non-empty", () => {
    expect(timingSafeCompare("", "notempty")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeCompare("", "")).toBe(true);
  });

  it("returns false when one character differs at the end", () => {
    expect(timingSafeCompare("api-key-abc123x", "api-key-abc123y")).toBe(false);
  });

  it("handles strings with special characters", () => {
    const key = "sk-ant-api03-abc123!@#$%^&*()_+";
    expect(timingSafeCompare(key, key)).toBe(true);
    expect(timingSafeCompare(key, key + "x")).toBe(false);
  });
});

describe("sha256hex", () => {
  it("produces known hash for 'hello'", () => {
    expect(sha256hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("accepts a Buffer input", () => {
    expect(sha256hex(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("returns 64 hex characters (256 bits)", () => {
    expect(sha256hex("any input")).toHaveLength(64);
    expect(sha256hex("any input")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("empty string produces known hash", () => {
    expect(sha256hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("hmacSign + hmacVerify", () => {
  it("returns a 32-byte Buffer (SHA-256 HMAC)", () => {
    const sig = hmacSign("key", "data");
    expect(Buffer.isBuffer(sig)).toBe(true);
    expect(sig.length).toBe(32);
  });

  it("roundtrip: hmacVerify accepts the result of hmacSign", () => {
    const key  = "test-key";
    const data = "test-data";
    const sig  = hmacSign(key, data);
    expect(hmacVerify(key, data, sig)).toBe(true);
  });

  it("hmacVerify rejects wrong data", () => {
    const key = "test-key";
    const sig = hmacSign(key, "test-data");
    expect(hmacVerify(key, "wrong-data", sig)).toBe(false);
  });

  it("hmacVerify rejects wrong key", () => {
    const data = "test-data";
    const sig  = hmacSign("correct-key", data);
    expect(hmacVerify("wrong-key", data, sig)).toBe(false);
  });

  it("hmacVerify returns false for different-length expected buffer", () => {
    const sig = hmacSign("key", "data");
    expect(hmacVerify("key", "data", sig.slice(0, 16))).toBe(false);
  });
});

describe("timingSafeEqualBuffers", () => {
  it("returns true for equal buffers", () => {
    const a = Buffer.from("abc");
    const b = Buffer.from("abc");
    expect(timingSafeEqualBuffers(a, b)).toBe(true);
  });

  it("returns false for different buffers of same length", () => {
    const a = Buffer.from("abc");
    const c = Buffer.from("xyz");
    expect(timingSafeEqualBuffers(a, c)).toBe(false);
  });

  it("returns false for different-length buffers (no timing leak)", () => {
    const a = Buffer.from("abc");
    const b = Buffer.from("ab");
    expect(timingSafeEqualBuffers(a, b)).toBe(false);
  });
});

describe("generateSecret", () => {
  it("returns a 64-char hex string by default (32 bytes)", () => {
    const secret = generateSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("respects custom byte count", () => {
    expect(generateSecret(16)).toHaveLength(32);
    expect(generateSecret(64)).toHaveLength(128);
  });

  it("generates unique values on each call", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
  });
});
