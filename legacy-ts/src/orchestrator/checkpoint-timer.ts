// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Silent checkpoint timer.
 *
 * Runs a full silent checkpoint every `intervalMs` milliseconds:
 * 1. Persists in-memory chat history to SQLite
 * 2. Persists in-memory rate-limiter state to SQLite
 * 3. Flushes the SQLite WAL (PASSIVE mode — non-blocking)
 *
 * Checkpoint failure NEVER crashes the orchestrator.
 * The timer is unref()'d — it does not prevent the process from exiting.
 */

import type { Database }          from "better-sqlite3";
import { createLogger }           from "../core/logger.js";
import type { DeploymentMode }    from "../core/deployment-mode.js";
import { persistChatState }       from "../api/routes/chat.js";
import { persistRateLimiterState } from "../api/middleware/rate-limiter.js";

const logger = createLogger("checkpoint-timer");


export class CheckpointTimer {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db:             Database,
    private readonly intervalMs:     number         = 60_000,
    private readonly deploymentMode: DeploymentMode = "desktop",
  ) {}

  /** Start the periodic silent checkpoint timer. Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => { this.runPeriodicCheckpoint(); }, this.intervalMs);
    this.timer.unref(); // Don't prevent process exit
    logger.debug("checkpoint-timer", "Silent checkpoint timer started", {
      metadata: { interval_ms: this.intervalMs, mode: this.deploymentMode },
    });
  }

  /** Stop the timer. Idempotent. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      logger.debug("checkpoint-timer", "Silent checkpoint timer stopped", {});
    }
  }

  /** Run a full silent checkpoint immediately (also called by the interval). */
  runPeriodicCheckpoint(): void {
    try {
      // 1. Chat history
      persistChatState(this.db);

      // 2. Rate limiter state
      persistRateLimiterState(this.db);

      // 3. WAL checkpoint — PASSIVE so writers are never blocked
      this.db.pragma("wal_checkpoint(PASSIVE)");

      logger.debug("checkpoint-timer", "Silent checkpoint complete", {
        metadata: { mode: this.deploymentMode, interval_ms: this.intervalMs },
      });
    } catch (e: unknown) {
      // Checkpoint failure must NEVER crash the orchestrator
      logger.warn("checkpoint-timer", "Silent checkpoint failed — non-fatal", {
        metadata: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}
