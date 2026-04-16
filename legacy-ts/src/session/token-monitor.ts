// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 186: TokenMonitor
 *
 * Tracks cumulative token usage across reasoning turns within a session.
 * Persists state to SQLite so sessions survive process restarts.
 *
 * Lifecycle:
 *   startSession()  — opens a new session row in session_token_usage
 *   recordTokens()  — adds tokens from one reasoning turn; updates state
 *   getState()      — reads current session state
 *   closeSession()  — marks session as 'rotated' (terminal state)
 *
 * ThresholdHandler is called by the consumer after recordTokens().
 * TokenMonitor itself does NOT trigger rotation — it is a pure tracker.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "../utils/db.js";
import { createLogger } from "../core/logger.js";
import {
  resolveContextWindow,
  type SessionTokenState,
  type SessionStatus,
  type SessionAuditEvent,
  type SessionAuditEntry,
} from "./types.js";

const logger = createLogger("session-token-monitor");


interface SessionRow {
  session_id:    string;
  agent_id:      string;
  task_id:       string;
  tokens_used:   number;
  context_limit: number;
  turn_count:    number;
  status:        string;
  started_at:    string;
  last_updated:  string;
}


export class TokenMonitor {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // -------------------------------------------------------------------------
  // startSession
  // -------------------------------------------------------------------------

  /**
   * Open a new session for an agent/task pair.
   *
   * @param agentId  Agent definition ID
   * @param taskId   Task being executed in this session
   * @param model    Model ID — used to resolve default context window
   * @param contextWindowOverride  Override from SessionConfig (optional)
   * @returns sessionId (UUID)
   */
  startSession(
    agentId:               string,
    taskId:                string,
    model:                 string,
    contextWindowOverride?: number,
  ): string {
    const sessionId    = randomUUID();
    const contextLimit = contextWindowOverride ?? resolveContextWindow(model);
    const now          = new Date().toISOString();

    this.db.prepare<[string, string, string, number, string, string], void>(`
      INSERT INTO session_token_usage
        (session_id, agent_id, task_id, tokens_used, context_limit, turn_count,
         status, started_at, last_updated)
      VALUES (?, ?, ?, 0, ?, 0, 'active', ?, ?)
    `).run(sessionId, agentId, taskId, contextLimit, now, now);

    this._audit(sessionId, agentId, "session_started", 0, 0, `model=${model} limit=${contextLimit}`);

    logger.info("session_started", `Session ${sessionId} opened`, {
      metadata: { sessionId, agentId, taskId, contextLimit },
    });

    return sessionId;
  }

  // -------------------------------------------------------------------------
  // recordTokens
  // -------------------------------------------------------------------------

  /**
   * Add tokens consumed by a single reasoning turn.
   *
   * @param sessionId  Session to update
   * @param tokens     Tokens to add (input + output combined)
   * @returns Updated SessionTokenState (or null if session not found)
   */
  recordTokens(sessionId: string, tokens: number): SessionTokenState | null {
    const now = new Date().toISOString();

    const result = this.db.prepare<[number, string, string], { changes: number }>(`
      UPDATE session_token_usage
      SET tokens_used  = tokens_used + ?,
          turn_count   = turn_count + 1,
          last_updated = ?
      WHERE session_id = ? AND status NOT IN ('rotated', 'rotating')
    `).run(tokens, now, sessionId);

    if (result.changes === 0) {
      return null; // session not found or already terminal
    }

    const state = this.getState(sessionId);
    if (state !== null) {
      this._audit(
        sessionId, state.agent_id,
        "tokens_recorded",
        state.tokens_used,
        state.percent_used,
        `+${tokens} tokens, turn ${state.turn_count}`,
      );
    }

    return state;
  }

  // -------------------------------------------------------------------------
  // getState
  // -------------------------------------------------------------------------

  /**
   * Read the current state of a session.
   * Returns null when the session does not exist.
   */
  getState(sessionId: string): SessionTokenState | null {
    const row = this.db.prepare<[string], SessionRow>(`
      SELECT * FROM session_token_usage WHERE session_id = ?
    `).get(sessionId);

    if (row === undefined) return null;
    return this._rowToState(row);
  }

  // -------------------------------------------------------------------------
  // markWarned
  // -------------------------------------------------------------------------

  /**
   * Transition session status to 'warned'.
   * Idempotent — no-op if already in warned/rotating/rotated state.
   */
  markWarned(sessionId: string): void {
    const row = this.db.prepare<[string], Pick<SessionRow, "agent_id" | "tokens_used" | "context_limit">>(`
      SELECT agent_id, tokens_used, context_limit FROM session_token_usage
      WHERE session_id = ?
    `).get(sessionId);

    if (row === undefined) return;

    this.db.prepare<[string], void>(`
      UPDATE session_token_usage
      SET status = 'warned'
      WHERE session_id = ? AND status = 'active'
    `).run(sessionId);

    const pct = (row.tokens_used / row.context_limit) * 100;
    this._audit(sessionId, row.agent_id, "warn_threshold_reached", row.tokens_used, pct);
  }

  // -------------------------------------------------------------------------
  // markRotating
  // -------------------------------------------------------------------------

  /**
   * Transition session to 'rotating' — called just before rotation begins.
   * Returns false if the session is not in active/warned status.
   */
  markRotating(sessionId: string): boolean {
    const row = this.db.prepare<[string], Pick<SessionRow, "agent_id" | "tokens_used" | "context_limit">>(`
      SELECT agent_id, tokens_used, context_limit FROM session_token_usage
      WHERE session_id = ? AND status IN ('active', 'warned')
    `).get(sessionId);

    if (row === undefined) return false;

    this.db.prepare<[string], void>(`
      UPDATE session_token_usage
      SET status = 'rotating'
      WHERE session_id = ?
    `).run(sessionId);

    const pct = (row.tokens_used / row.context_limit) * 100;
    this._audit(sessionId, row.agent_id, "rotate_threshold_reached", row.tokens_used, pct);
    return true;
  }

  // -------------------------------------------------------------------------
  // closeSession
  // -------------------------------------------------------------------------

  /**
   * Mark a session as 'rotated' (terminal state).
   * Called after the briefing has been generated and a new session has opened.
   */
  closeSession(sessionId: string): void {
    const row = this.db.prepare<[string], Pick<SessionRow, "agent_id" | "tokens_used" | "context_limit">>(`
      SELECT agent_id, tokens_used, context_limit FROM session_token_usage
      WHERE session_id = ?
    `).get(sessionId);

    if (row === undefined) return;

    this.db.prepare<[string], void>(`
      UPDATE session_token_usage
      SET status = 'rotated'
      WHERE session_id = ?
    `).run(sessionId);

    const pct = (row.tokens_used / row.context_limit) * 100;
    this._audit(sessionId, row.agent_id, "session_closed", row.tokens_used, pct);

    logger.info("session_closed", `Session ${sessionId} rotated`, {
      metadata: { sessionId, agent_id: row.agent_id, tokens: row.tokens_used },
    });
  }

  // -------------------------------------------------------------------------
  // getSessionCount
  // -------------------------------------------------------------------------

  /**
   * Return the number of sessions (including rotated) for an agent/task pair.
   * Used to derive the session_number for new checkpoints.
   */
  getSessionCount(agentId: string, taskId: string): number {
    const row = this.db.prepare<[string, string], { cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM session_token_usage
      WHERE agent_id = ? AND task_id = ?
    `).get(agentId, taskId);
    return row?.cnt ?? 0;
  }

  // -------------------------------------------------------------------------
  // getAuditLog
  // -------------------------------------------------------------------------

  /**
   * Return the last N audit entries for a session, newest first.
   */
  getAuditLog(sessionId: string, limit = 50): SessionAuditEntry[] {
    return this.db.prepare<[string, number], SessionAuditEntry>(`
      SELECT * FROM session_audit_log
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _rowToState(row: SessionRow): SessionTokenState {
    const pct = row.context_limit > 0
      ? (row.tokens_used / row.context_limit) * 100
      : 0;
    return {
      session_id:    row.session_id,
      agent_id:      row.agent_id,
      task_id:       row.task_id,
      tokens_used:   row.tokens_used,
      context_limit: row.context_limit,
      percent_used:  Math.round(pct * 100) / 100,
      turn_count:    row.turn_count,
      started_at:    row.started_at,
      last_updated:  row.last_updated,
      status:        row.status as SessionStatus,
    };
  }

  private _audit(
    sessionId:  string,
    agentId:    string,
    event:      SessionAuditEvent,
    tokens:     number,
    percent:    number,
    detail?:    string,
  ): void {
    try {
      this.db.prepare<[string, string, string, string, number, number, string | null], void>(`
        INSERT INTO session_audit_log
          (id, session_id, agent_id, event, tokens_at_event, percent_at_event, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(randomUUID(), sessionId, agentId, event, tokens, percent, detail ?? null);
    } catch (_e) {
      // Non-fatal — audit log failure must not break execution
    }
  }
}
