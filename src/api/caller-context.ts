// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Shared CallerContext interface for route-level authorization.
 *
 * V1.0: Derived from API key authentication middleware.
 *       All valid API-key requests receive role="operator".
 * V1.1: Will be derived from scoped token with division binding (ARC-201).
 * V2.0: Will include full RBAC permissions (ARC-303).
 */

export interface CallerContext {
  /**
   * Authorization role of the caller.
   * Undefined means no authenticated context (deny sensitive operations).
   */
  role?: "admin" | "operator" | "agent" | "readonly";
  /** Set when an agent is making the call on its own behalf. */
  agentId?: string;
  /** Bound to token scope — restricts access to this division's resources. */
  division?: string;
  /** ID of the API token used for this request (audit trail). */
  tokenId?: string;
}

/** Returns true when the caller holds operator (or admin) level access. */
export function isOperatorContext(ctx: CallerContext): boolean {
  return ctx.role === "operator" || ctx.role === "admin";
}
