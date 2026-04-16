// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Guide: Embedded Cloudflare Credentials
 *
 * SIDJUA's own AI-inference-only Cloudflare Workers AI credentials.
 * These are NOT the user's credentials — they are SIDJUA's embedded
 * token for the Guide agent's zero-config first experience.
 *
 * Security:
 *   - Token is AI inference ONLY — cannot access other Cloudflare resources
 *   - MUST NEVER appear in logs, error messages, or user-visible output
 *   - Override via env vars for testing: SIDJUA_CF_ACCOUNT_ID, SIDJUA_CF_TOKEN
 *
 * In production builds, _EA and _ET are replaced with XOR-encoded bytes
 * of the real credentials by the release pipeline.
 */

// XOR key for credential encoding
const _EK = "sidjua-guide-inference-token-key";

// XOR-encoded account ID bytes (empty = placeholder; replaced at release build)
const _EA: number[] = [];

// XOR-encoded API token bytes (empty = placeholder; replaced at release build)
const _ET: number[] = [];

function _decode(bytes: number[], key: string): string {
  if (bytes.length === 0) return "";
  return Buffer.from(
    bytes.map((b, i) => b ^ key.charCodeAt(i % key.length)),
  ).toString("ascii");
}

export const PLACEHOLDER_ACCOUNT_ID = "PLACEHOLDER_ACCOUNT_ID";
export const PLACEHOLDER_CF_TOKEN   = "PLACEHOLDER_CF_TOKEN";

/** SIDJUA's embedded Cloudflare account ID for the Guide agent. */
export function getEmbeddedAccountId(): string {
  const fromEnv  = process.env["SIDJUA_CF_ACCOUNT_ID"];
  const fromCode = _decode(_EA, _EK);
  return (fromEnv ?? fromCode) || PLACEHOLDER_ACCOUNT_ID;
}

/** SIDJUA's embedded Cloudflare AI inference token for the Guide agent. */
export function getEmbeddedToken(): string {
  const fromEnv  = process.env["SIDJUA_CF_TOKEN"];
  const fromCode = _decode(_ET, _EK);
  return (fromEnv ?? fromCode) || PLACEHOLDER_CF_TOKEN;
}

/** True when real (non-placeholder) embedded credentials are present. */
export function hasEmbeddedCredentials(): boolean {
  const accountId = getEmbeddedAccountId();
  const token     = getEmbeddedToken();
  return (
    accountId !== PLACEHOLDER_ACCOUNT_ID &&
    token     !== PLACEHOLDER_CF_TOKEN   &&
    accountId.trim().length > 0 &&
    token.trim().length > 0
  );
}
