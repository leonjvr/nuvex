// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider URL validation (SSRF protection).
 *
 * Validates outbound provider API base URLs to prevent server-side request
 * forgery. Applied before any server-side fetch to an external endpoint.
 *
 * Enterprise seam: `validateProviderUrl` accepts an `allowCustom` flag so
 * operators can extend the allowed-domain set without patching this file.
 */

/** IPv4/IPv6 private and reserved address patterns. */
const PRIVATE_RANGES: RegExp[] = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,   // link-local
  /^::1$/,         // IPv6 loopback
  /^fc00:/i,       // IPv6 unique local
  /^fe80:/i,       // IPv6 link-local
  /^fd[0-9a-f]{2}/i, // IPv6 ULA
  /^0\.0\.0\.0$/,
  /^255\./,        // broadcast
  /^224\./,        // multicast
];

/**
 * Official provider domains approved for outbound test requests.
 * Subdomains of these hosts are also accepted.
 */
export const KNOWN_PROVIDER_DOMAINS: ReadonlyArray<string> = [
  "api.openai.com",
  "api.anthropic.com",
  "api.groq.com",
  "generativelanguage.googleapis.com",
  "api.x.ai",
  "api.deepseek.com",
  "api.mistral.ai",
  "api.together.xyz",
  "openrouter.ai",
  "api.cohere.com",
];

export interface UrlValidationResult {
  valid:    boolean;
  reason?:  string;
}

export interface ValidateProviderUrlOptions {
  /** Allow any HTTPS URL, not just known provider domains. Default: false. */
  allowCustom?: boolean;
}

/**
 * Validate a provider API base URL before making a server-side request.
 *
 * Rejects:
 *   - Non-HTTPS URLs (except http://localhost for local dev)
 *   - Private/reserved IP address ranges
 *   - Unknown provider domains (unless `allowCustom` is true)
 *
 * @param urlString - The URL to validate.
 * @param opts      - Validation options.
 * @returns `{ valid: true }` or `{ valid: false, reason: "..." }`.
 */
export function validateProviderUrl(
  urlString: string,
  opts?: ValidateProviderUrlOptions,
): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (_e) {
    return { valid: false, reason: "Invalid URL format" };
  }

  const { hostname, protocol } = url;

  // Allow http only for localhost (local development)
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (protocol !== "https:" && !(protocol === "http:" && isLocalhost)) {
    return { valid: false, reason: "Only HTTPS is allowed (http://localhost is permitted for local dev)" };
  }

  // Block private / reserved address ranges
  for (const range of PRIVATE_RANGES) {
    if (range.test(hostname)) {
      return { valid: false, reason: `Private or reserved address not allowed: ${hostname}` };
    }
  }

  // If not allowing custom providers, require a known domain
  if (!opts?.allowCustom) {
    const isKnown = KNOWN_PROVIDER_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`),
    );
    if (!isKnown) {
      return {
        valid:  false,
        reason: `Unknown provider domain: ${hostname}. Set allow_custom_providers: true in config to allow custom endpoints.`,
      };
    }
  }

  return { valid: true };
}
