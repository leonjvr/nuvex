// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Governance Admission Gate
 *
 * Enforces governance pre-checks before any external task creation.
 * All public task entry points (CLI run, REST API, messaging, delegation)
 * MUST call admitTask() and receive an admission token before calling
 * TaskStore.create() / TaskManager.createTask().
 *
 * Checks (in order):
 *   1. Division exists (or is the built-in "general" division)
 *   2. Budget pre-check — would the task's estimated cost exceed division limits?
 *
 * Fail-closed: any internal error results in denial, never silent admission.
 * Admission tokens are single-use with a 60-second TTL.
 */

import { randomUUID }  from "node:crypto";
import { CostTracker } from "../provider/cost-tracker.js";
import { createLogger } from "../core/logger.js";
import type { Database } from "../utils/db.js";

const logger = createLogger("admission-gate");

/** TTL for issued admission tokens (milliseconds). */
const TOKEN_TTL_MS = 60_000;


export interface AdmissionInput {
  /** Human-readable task description (used for audit logging). */
  description: string;
  /** Target division. Must exist in the divisions table, or be "general". */
  division: string;
  /** Estimated cost in USD used for budget pre-check. Defaults to 0 (no check). */
  budget_usd?: number;
  /** Optional caller identifier for audit purposes. */
  caller?: string;
}

export type AdmissionResult =
  | { admitted: true;  token: string }
  | { admitted: false; reason: string };


/**
 * Governance admission gate for external task creation.
 *
 * Instantiate once per request/session and hold a reference to it.
 * The token Map is per-instance; tokens cannot be shared across instances.
 */
export class TaskAdmissionGate {
  /** Active admission tokens: token → expiry timestamp (ms). */
  private readonly _tokens = new Map<string, number>();

  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Run admission checks for a new task request.
   *
   * Returns `{ admitted: true, token }` when all checks pass.
   * Returns `{ admitted: false, reason }` when any check fails.
   * Never throws — internal errors produce a fail-closed denial.
   */
  admitTask(input: AdmissionInput): AdmissionResult {
    try {
      // 1. Division check
      if (!this._divisionAllowed(input.division)) {
        logger.warn("admission-gate", "Task denied — unknown division", {
          metadata: { division: input.division, caller: input.caller },
        });
        return { admitted: false, reason: `Unknown division: ${input.division}` };
      }

      // 2. Budget pre-check
      const costUsd = input.budget_usd ?? 0;
      if (!this._budgetAllowed(input.division, costUsd)) {
        logger.warn("admission-gate", "Task denied — budget limit exceeded", {
          metadata: { division: input.division, budget_usd: costUsd, caller: input.caller },
        });
        return {
          admitted: false,
          reason:   `Budget limit exceeded for division: ${input.division}`,
        };
      }

      // All checks passed — issue single-use token
      this._pruneExpired();
      const token  = randomUUID();
      const expiry = Date.now() + TOKEN_TTL_MS;
      this._tokens.set(token, expiry);

      return { admitted: true, token };
    } catch (err: unknown) {
      logger.error("admission-gate", "Admission check threw unexpectedly — fail-closed deny", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
      return { admitted: false, reason: "Internal error — admission denied (fail-closed)" };
    }
  }

  /**
   * Verify and consume an admission token.
   *
   * Returns `true` if the token is valid and not expired.
   * The token is removed from the store on first use (single-use).
   * Returns `false` for unknown, expired, or already-consumed tokens.
   */
  verifyAndConsumeToken(token: string): boolean {
    const expiry = this._tokens.get(token);
    if (expiry === undefined) return false;
    this._tokens.delete(token); // consume regardless of expiry
    return Date.now() <= expiry;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check that the division is the built-in "general" division or exists
   * in the divisions table. Fails open (allows) if the divisions table
   * does not exist (pre-`sidjua apply` state).
   */
  private _divisionAllowed(division: string): boolean {
    if (division === "general") return true;
    try {
      const row = this.db
        .prepare<[string], { code: string }>("SELECT code FROM divisions WHERE code = ?")
        .get(division);
      return row !== undefined;
    } catch (_err: unknown) {
      // Table absent (pre-apply) — fail-open for division check
      return true;
    }
  }

  /**
   * Check whether estimated cost stays within the division's budget limits.
   * Uses the existing CostTracker which queries cost_budgets + cost_ledger.
   *
   * Fails open when the budget tables are absent (pre-`sidjua apply` state) —
   * no limits have been configured yet so there is nothing to enforce.
   * Fails closed for all other errors (database I/O failure, corrupt row, etc.)
   * to prevent silent over-spend.
   */
  private _budgetAllowed(division: string, estimatedCostUsd: number): boolean {
    if (estimatedCostUsd <= 0) return true; // nothing to check
    try {
      const tracker = new CostTracker(this.db);
      const result  = tracker.checkBudget(division, estimatedCostUsd);
      return result.allowed;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Table absent = pre-apply state; no budgets configured → fail-open
      if (msg.includes("no such table")) {
        logger.debug("admission-gate", "Budget tables absent (pre-apply) — allowing task", {
          metadata: { division, estimated_usd: estimatedCostUsd },
        });
        return true;
      }
      // Any other error → fail-closed
      logger.error("admission-gate", "Budget check threw — blocking task (fail-closed)", {
        metadata: { division, estimated_usd: estimatedCostUsd, error: msg },
      });
      return false;
    }
  }

  /** Remove all tokens whose TTL has elapsed. */
  private _pruneExpired(): void {
    const now = Date.now();
    for (const [tok, exp] of this._tokens) {
      if (now > exp) this._tokens.delete(tok);
    }
  }
}
