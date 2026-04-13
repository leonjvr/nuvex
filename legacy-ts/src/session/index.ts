// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 186: Session Lifecycle (Tier 1) — public API
 */

export { runSessionMigrations, SESSION_MIGRATIONS } from "./migration.js";
export { TokenMonitor }         from "./token-monitor.js";
export { ThresholdHandler, DEFAULT_WARN_PERCENT, DEFAULT_ROTATE_PERCENT } from "./threshold-handler.js";
export { MemoryBriefingGenerator } from "./memory-briefing.js";
export { SessionRotateHandler } from "./session-rotate-handler.js";
export type {
  SessionConfig,
  SessionStatus,
  SessionTokenState,
  SessionCheckpoint,
  SessionAuditEntry,
  SessionAuditEvent,
  ThresholdAction,
  ThresholdCheckResult,
  SessionRotationResult,
  BriefingLevel,
} from "./types.js";
export {
  MODEL_CONTEXT_WINDOWS,
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow,
} from "./types.js";
export type { BriefingMessage } from "./memory-briefing.js";
