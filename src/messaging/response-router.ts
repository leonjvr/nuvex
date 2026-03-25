// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: ResponseRouter
 *
 * Routes agent task responses back to the originating messaging user.
 *
 * Flow:
 *   1. When a task is created from a message, call registerTaskOrigin(taskId, envelope)
 *   2. When the task completes, call routeResponse(taskId, responseText)
 *   3. ResponseRouter finds the original adapter instance and sends via it
 *   4. The origin is cleaned up after each response
 */

import type { AdapterRegistry } from "./adapter-registry.js";
import type { MessageEnvelope, MessagingGovernance, MessagingTaskHandle } from "./types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("response-router");


export class ResponseRouter {
  /**
   * Maps task IDs to the MessageEnvelope that originated the task.
   * Cleaned up after response is sent (or if task origin is not found).
   */
  private readonly origins = new Map<string, MessageEnvelope>();

  constructor(
    private readonly registry:   AdapterRegistry,
    private readonly governance: MessagingGovernance,
  ) {}

  // ---------------------------------------------------------------------------
  // Origin registration
  // ---------------------------------------------------------------------------

  /**
   * Record that taskId was created in response to envelope.
   * Must be called before routeResponse() to enable response routing.
   */
  registerTaskOrigin(taskId: string, envelope: MessageEnvelope): void {
    this.origins.set(taskId, envelope);
  }

  // ---------------------------------------------------------------------------
  // Response routing
  // ---------------------------------------------------------------------------

  /**
   * Send an agent response back to the originating chat.
   *
   * Steps:
   *   1. Find the stored envelope for taskId (no-op if missing)
   *   2. Get the adapter instance that received the original message
   *   3. Format via adapter.formatText() if available
   *   4. Truncate to governance.response_max_length
   *   5. Optionally prepend task ID
   *   6. Send and clean up
   */
  async routeResponse(taskId: string, response: string): Promise<void> {
    const origin = this.origins.get(taskId);
    if (origin === undefined) {
      logger.warn("response-router", "No origin registered for task — dropping response", {
        metadata: { task_id: taskId },
      });
      return;
    }

    const instance = this.registry.getInstance(origin.instance_id);
    if (instance === undefined) {
      logger.warn("response-router", "Adapter instance not found — dropping response", {
        metadata: {
          event:       "RESPONSE_FAILED" as const,
          task_id:     taskId,
          instance_id: origin.instance_id,
        },
      });
      this.origins.delete(taskId);
      return;
    }

    // Format via adapter's own formatter if provided
    let formatted = instance.formatText !== undefined
      ? instance.formatText(response)
      : response;

    // Truncate to governance limit
    formatted = this._truncate(formatted, this.governance.response_max_length);

    // Optionally prepend task ID
    if (this.governance.include_task_id_in_response) {
      formatted = `[${taskId.slice(0, 8)}] ${formatted}`;
    }

    try {
      await instance.sendResponse(origin.metadata.chat_id, formatted, {
        reply_to_message_id: origin.id,
      });

      logger.info("response-router", "Response sent", {
        metadata: {
          event:       "RESPONSE_SENT" as const,
          task_id:     taskId,
          instance_id: origin.instance_id,
          chat_id:     origin.metadata.chat_id,
        },
      });
    } catch (e: unknown) {
      logger.warn("response-router", "Failed to send response", {
        metadata: {
          event:       "RESPONSE_FAILED" as const,
          task_id:     taskId,
          instance_id: origin.instance_id,
          error:       e instanceof Error ? e.message : String(e),
        },
      });
    } finally {
      // Always clean up origin regardless of send success
      this.origins.delete(taskId);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _truncate(text: string, max: number): string {
    if (max <= 0 || text.length <= max) return text;
    return text.slice(0, max - 3) + "...";
  }

  /** Return the number of pending origins (for testing/monitoring). */
  get pendingOrigins(): number {
    return this.origins.size;
  }

  // ---------------------------------------------------------------------------
  // P270 B3: State persistence
  // ---------------------------------------------------------------------------

  /**
   * Persist all in-memory task origins to SQLite.
   * Call on server shutdown to survive restarts mid-task.
   */
  persistOrigins(db: import("../utils/db.js").Database): void {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS response_origins (
          task_id    TEXT PRIMARY KEY,
          envelope   TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      const upsert = db.prepare<[string, string, string], void>(
        "INSERT OR REPLACE INTO response_origins (task_id, envelope, created_at) VALUES (?, ?, ?)",
      );
      const now = new Date().toISOString();
      const run = db.transaction(() => {
        for (const [taskId, envelope] of this.origins) {
          upsert.run(taskId, JSON.stringify(envelope), now);
        }
      });
      run();
    } catch (e: unknown) {
      logger.warn("response-router", "persistOrigins failed — non-fatal", {
        metadata: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  /**
   * Restore task origins from SQLite into the in-memory map.
   * Call on startup before routing begins.
   * Returns number of origins restored.
   */
  restoreOrigins(db: import("../utils/db.js").Database): number {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS response_origins (
          task_id    TEXT PRIMARY KEY,
          envelope   TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      const rows = db.prepare<[], { task_id: string; envelope: string }>(
        "SELECT task_id, envelope FROM response_origins",
      ).all();
      for (const row of rows) {
        try {
          const envelope = JSON.parse(row.envelope) as import("./types.js").MessageEnvelope;
          this.origins.set(row.task_id, envelope);
        } catch (_e) { /* skip malformed rows */ }
      }
      return rows.length;
    } catch (e: unknown) {
      logger.warn("response-router", "restoreOrigins failed — starting fresh", {
        metadata: { error: e instanceof Error ? e.message : String(e) },
      });
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Direct messaging helpers (P222 — MessageToTaskBridge)
  // ---------------------------------------------------------------------------

  /** Send a message directly to the originating chat without task routing. */
  async sendDirectMessage(envelope: MessageEnvelope, text: string): Promise<void> {
    const instance = this.registry.getInstance(envelope.instance_id);
    if (instance === undefined) {
      logger.warn("response-router", "Adapter instance not found for direct message", {
        metadata: { instance_id: envelope.instance_id },
      });
      return;
    }
    try {
      await instance.sendResponse(envelope.metadata.chat_id, text, {
        reply_to_message_id: envelope.id,
      });
    } catch (e: unknown) {
      logger.warn("response-router", "Failed to send direct message", {
        metadata: { instance_id: envelope.instance_id, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  /** Notify user that their request is not authorized. */
  async sendUnauthorized(envelope: MessageEnvelope): Promise<void> {
    await this.sendDirectMessage(
      envelope,
      "Nicht autorisiert. Kontaktieren Sie einen Admin um Zugang zu erhalten.",
    );
  }

  /** Confirm that a task was created (optionally noting it was via override). */
  async sendTaskAccepted(
    envelope: MessageEnvelope,
    handle: MessagingTaskHandle,
    isOverride: boolean,
  ): Promise<void> {
    const overrideNote = isOverride ? " (mit Override)" : "";
    const desc = handle.description.length > 60
      ? handle.description.slice(0, 57) + "..."
      : handle.description;
    const budgetStr = handle.budget_usd !== null
      ? handle.budget_usd.toFixed(2)
      : "unbegrenzt";
    await this.sendDirectMessage(
      envelope,
      `Task #${handle.id.slice(0, 8)} erstellt${overrideNote}: "${desc}"\n` +
      `Agent: ${handle.agent_id ?? "unassigned"} | Budget: ${budgetStr}`,
    );
  }

  /** Notify user that their task was blocked by governance. */
  async sendBlocked(
    envelope: MessageEnvelope,
    reason: string,
    rule: string,
    overrideHint: string,
  ): Promise<void> {
    await this.sendDirectMessage(
      envelope,
      `Task blockiert — Regelverletzung:\n${reason}\nRegel: ${rule}${overrideHint}`,
    );
  }

  /** Notify user that their task completed successfully. */
  async sendTaskCompleted(
    envelope: MessageEnvelope,
    handle: MessagingTaskHandle,
    summary: string,
    durationSec: number,
    costUsd: number,
  ): Promise<void> {
    const truncSummary = summary.length > 500 ? summary.slice(0, 497) + "..." : summary;
    await this.sendDirectMessage(
      envelope,
      `Task #${handle.id.slice(0, 8)} abgeschlossen (${this._formatDuration(durationSec)}, $${costUsd.toFixed(2)})\n${truncSummary}`,
    );
  }

  /** Notify user that their task failed. */
  async sendTaskFailed(
    envelope: MessageEnvelope,
    handle: MessagingTaskHandle,
    error: string,
  ): Promise<void> {
    await this.sendDirectMessage(
      envelope,
      `Task #${handle.id.slice(0, 8)} fehlgeschlagen: ${error}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
}
