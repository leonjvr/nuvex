// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 186: ThresholdHandler
 *
 * Pure function layer that decides what action to take based on the current
 * session token usage and the agent's SessionConfig thresholds.
 *
 * Does not write to the database — TokenMonitor owns state transitions.
 * The caller (ReasoningLoop integration) acts on the returned ThresholdAction.
 */

import type {
  SessionTokenState,
  SessionConfig,
  ThresholdAction,
  ThresholdCheckResult,
} from "./types.js";


export const DEFAULT_WARN_PERCENT   = 70;
export const DEFAULT_ROTATE_PERCENT = 85;


export class ThresholdHandler {
  /**
   * Check the current session state against configured thresholds.
   *
   * @param state   Current session token state (from TokenMonitor.recordTokens or getState)
   * @param config  Agent session config (optional — falls back to defaults)
   * @returns ThresholdCheckResult with the recommended action
   */
  check(state: SessionTokenState, config?: SessionConfig): ThresholdCheckResult {
    const warnAt   = config?.warn_threshold_percent   ?? DEFAULT_WARN_PERCENT;
    const rotateAt = config?.rotate_threshold_percent ?? DEFAULT_ROTATE_PERCENT;

    // Clamp to valid ranges
    const safeWarnAt   = Math.max(10, Math.min(95, warnAt));
    const safeRotateAt = Math.max(safeWarnAt + 1, Math.min(99, rotateAt));

    let action: ThresholdAction = "ok";

    if (state.percent_used >= safeRotateAt) {
      action = "rotate";
    } else if (state.percent_used >= safeWarnAt && state.status === "active") {
      action = "warn";
    }

    // Also rotate if max_session_turns reached
    if (
      action !== "rotate" &&
      config?.max_session_turns !== undefined &&
      config.max_session_turns > 0 &&
      state.turn_count >= config.max_session_turns
    ) {
      action = "rotate";
    }

    return {
      action,
      percent_used:  state.percent_used,
      tokens_used:   state.tokens_used,
      context_limit: state.context_limit,
      warn_at:       safeWarnAt,
      rotate_at:     safeRotateAt,
    };
  }

  /**
   * Convenience: check whether turn count alone triggers rotation.
   * Useful for callers that want to check before the LLM call.
   */
  isTurnLimitReached(turnCount: number, config?: SessionConfig): boolean {
    const max = config?.max_session_turns;
    if (max === undefined || max <= 0) return false;
    return turnCount >= max;
  }

  /**
   * Resolve effective thresholds (with defaults and clamping applied).
   */
  resolveThresholds(config?: SessionConfig): { warnAt: number; rotateAt: number } {
    const warnAt   = config?.warn_threshold_percent   ?? DEFAULT_WARN_PERCENT;
    const rotateAt = config?.rotate_threshold_percent ?? DEFAULT_ROTATE_PERCENT;
    const safeWarnAt   = Math.max(10, Math.min(95, warnAt));
    const safeRotateAt = Math.max(safeWarnAt + 1, Math.min(99, rotateAt));
    return { warnAt: safeWarnAt, rotateAt: safeRotateAt };
  }
}
