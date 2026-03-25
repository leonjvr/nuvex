// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Error Types
 *
 * Typed errors for the integration gateway governance layer.
 *
 * Error codes:
 *   CREDENTIALS_MISSING  — secret not found in division or global namespace
 *   AUTH_TYPE_UNKNOWN    — adapter auth.type is unrecognized
 *   POLICY_DENIED        — web access policy blocked the request
 *   BUDGET_EXCEEDED      — division budget limit reached
 *   RATE_LIMITED         — per-service or global rate limit hit
 *   TIMEOUT              — HTTP call timed out
 *   SERVICE_UNAVAILABLE  — target service returned a 5xx or connection error
 *   RESPONSE_SANITIZED   — response matched an injection pattern (IGW-008)
 *   APPROVAL_REQUIRED    — governance rule requires human/operator approval
 *   DOMAIN_BLOCKED       — adapter base_url domain not in division allow-list
 */

export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly service?: string,
    public readonly action?: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}
