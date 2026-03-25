/**
 * SIDJUA — Multi-Agent Governance Framework
 * Copyright (c) 2026 Götz Kohlberg
 *
 * Dual licensed under:
 *   - AGPL-3.0 (see LICENSE-AGPL)
 *   - SIDJUA Commercial License (see LICENSE-COMMERCIAL)
 *
 * Unless you have a signed Commercial License, your use is governed
 * by the AGPL-3.0. See LICENSE for details.
 */

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect } from "vitest";
import { encryptApiKey, decryptApiKey } from "../../src/api/key-store.js";

describe("decryptApiKey — fail-closed on corrupt ciphertext", () => {
  it("roundtrip: encrypt then decrypt returns original plaintext", () => {
    const key = "sk-test-abc123";
    const encrypted = encryptApiKey(key);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(key);
  });

  it("plaintext (not base64) is returned as-is (migration path)", () => {
    // A plaintext key shorter than 44 chars passes through isBase64Encrypted=false
    const plain = "my-short-key";
    const result = decryptApiKey(plain);
    expect(result).toBe(plain);
  });

  it("corrupted ciphertext returns null (fail-closed)", () => {
    // Construct a value that looks like base64 but is not valid AES-256-GCM ciphertext
    const corrupt = Buffer.alloc(40).fill(0xff).toString("base64");
    const result = decryptApiKey(corrupt);
    expect(result).toBeNull();
  });

  it("too-short base64 data returns null (fail-closed)", () => {
    // Valid base64 but decodes to < 33 bytes — cannot be valid ciphertext
    const tooShort = Buffer.alloc(10).toString("base64"); // 10 bytes → clearly < 33
    // isBase64Encrypted requires length >= 44 chars, so this won't reach the short-check
    // Test with exactly 44 chars that decode to < 33 bytes (padded)
    const shortButBase64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 43+1=44 chars, 32 bytes
    const result = decryptApiKey(shortButBase64);
    // 32 bytes < 33 → returns null
    expect(result).toBeNull();
  });
});
