// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Outbound URL / Host Validator (xAI-SEC / SSRF hardening)
 *
 * validateOutboundUrl()  — guards any server-side fetch against SSRF.
 * validateSshHost()      — guards SSH connectivity tests against SSRF.
 *
 * Both functions throw SidjuaError on violation; callers surface this as a
 * 400/422 response so the original URL never reaches the network.
 */

import { SidjuaError } from "./error-codes.js";

/**
 * Regex matching private, link-local, loopback, and reserved IP ranges.
 * Covers IPv4 RFC-1918, loopback, APIPA, and common IPv6 loopback forms.
 */
const PRIVATE_HOST_RE =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|localhost|::1|\[::1\]|fd[0-9a-f]{2}:.*)$/i;

/**
 * Validate that a URL is safe to fetch from a server-side context.
 *
 * Rejects:
 *   - Non-HTTP(S) schemes (file://, ftp://, etc.)
 *   - Private / loopback / link-local addresses (SSRF guard)
 *
 * @throws SidjuaError SSRF-001 on scheme violation
 * @throws SidjuaError SSRF-002 on private/loopback host
 */
export function validateOutboundUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw SidjuaError.from("SSRF-001", `Invalid URL: ${raw}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw SidjuaError.from(
      "SSRF-001",
      `Only HTTP(S) URLs are allowed for outbound requests (got "${parsed.protocol}")`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host)) {
    throw SidjuaError.from(
      "SSRF-002",
      `Private/loopback/link-local URLs are not allowed for outbound requests (host: "${host}")`,
    );
  }
}

/**
 * Validate that an SSH host is safe to connect to.
 *
 * Rejects private, loopback, and wildcard addresses so that the
 * SSH connectivity test endpoint cannot be used for internal network scanning.
 *
 * @throws SidjuaError SSRF-002 on private/loopback host
 */
export function validateSshHost(host: string): void {
  const normalized = host.trim().toLowerCase();
  if (!normalized || normalized === "*" || normalized === "0.0.0.0") {
    throw SidjuaError.from("SSRF-002", `Invalid SSH host: "${host}"`);
  }
  if (PRIVATE_HOST_RE.test(normalized)) {
    throw SidjuaError.from(
      "SSRF-002",
      `Private/loopback hosts are not allowed for SSH connectivity tests (host: "${host}")`,
    );
  }
}
