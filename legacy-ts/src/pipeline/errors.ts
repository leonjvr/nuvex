// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Governance pipeline error types
 *
 * GovernanceError is thrown when a pipeline error occurs (not a governance
 * BLOCK/PAUSE — those are normal verdicts). GovernanceError represents
 * unexpected failures such as config load failures or DB errors.
 *
 * Design: pipeline errors are fail-closed. A broken governance check
 * prevents the action from proceeding.
 */

export const GOVERNANCE_ERRORS = {
  CONFIG_LOAD_FAILED:   "Failed to load governance configuration",
  CONFIG_INVALID:       "Governance configuration validation failed",
  INVALID_ACTION_TYPE:  "Unknown action type with no fallback",
  INVALID_RESUME_TOKEN: "Resume token invalid or expired",
  APPROVAL_NOT_FOUND:   "Approval entry not found",
  DB_ERROR:             "Database operation failed",
  CONDITION_PARSE_ERROR: "Failed to parse condition expression",
} as const;

export type GovernanceErrorCode = keyof typeof GOVERNANCE_ERRORS;

/**
 * Thrown when the governance pipeline itself fails (not when an action is
 * blocked or paused — those are normal PipelineResult verdicts).
 *
 * Pipeline errors are fail-closed: the caller must treat any thrown
 * GovernanceError as a BLOCK on the agent action.
 */
export class GovernanceError extends Error {
  constructor(
    public readonly code: GovernanceErrorCode,
    message: string,
    public readonly stage?: string,
    public readonly recoverable: boolean = false,
  ) {
    super(message);
    this.name = "GovernanceError";
  }
}
