// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Shared crypto utilities
 *
 * Single source of truth for cryptographic operations (P9 consolidation).
 * All SHA-256 hashing, HMAC signing/verification, timing-safe comparison,
 * and random secret generation must go through this module.
 */

import { timingSafeEqual, createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Constant-time comparison of API keys using SHA-256 hashing.
 *
 * NOTE: This is NOT password hashing. API keys are high-entropy random tokens
 * that do not require computational stretching (argon2/bcrypt). SHA-256 is used
 * here solely to normalize inputs to fixed-length buffers for timingSafeEqual,
 * preventing timing attacks that could leak key length or content.
 *
 * CodeQL js/insufficient-password-hash is a false positive for this use case.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest(); // lgtm[js/insufficient-password-hash]
  const hashB = createHash("sha256").update(b).digest(); // lgtm[js/insufficient-password-hash]
  return timingSafeEqual(hashA, hashB);
}

/**
 * Compute SHA-256 hash of a string or Buffer, returning a hex string.
 */
export function sha256hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Compute HMAC-SHA256 of data using key, returning raw bytes (Buffer).
 */
export function hmacSign(key: string | Buffer, data: string | Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * Verify HMAC-SHA256 signature using timing-safe comparison.
 * Returns false immediately if buffer lengths differ (no timing leak).
 */
export function hmacVerify(key: string | Buffer, data: string | Buffer, expected: Buffer): boolean {
  const actual = hmacSign(key, data);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Timing-safe comparison of two Buffers.
 * Returns false immediately if lengths differ (no timing leak).
 */
export function timingSafeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Generate a cryptographically random hex string.
 * Default: 32 bytes = 64 hex characters.
 */
export function generateSecret(bytes: number = 32): string {
  return randomBytes(bytes).toString("hex");
}
