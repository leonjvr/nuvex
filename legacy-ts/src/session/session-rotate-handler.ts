// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 186: SessionRotateHandler
 *
 * Orchestrates the full session rotation sequence:
 *   1. Mark old session as 'rotating'
 *   2. Generate memory briefing from conversation history
 *   3. Persist the briefing as a SessionCheckpoint
 *   4. Close the old session
 *   5. Open a new session (new session_id)
 *   6. Return a fresh message array ready for the next reasoning turn
 *
 * This is the single authoritative handler for SESSION_ROTATE operations.
 * It does NOT call the LLM — it only transforms the conversation state.
 */

import { randomUUID } from "node:crypto";
import type { Database }              from "../utils/db.js";
import { createLogger }               from "../core/logger.js";
import type {
  SessionConfig,
  SessionCheckpoint,
  SessionRotationResult,
  BriefingLevel,
} from "./types.js";
import { TokenMonitor }               from "./token-monitor.js";
import { MemoryBriefingGenerator }    from "./memory-briefing.js";
import type { BriefingMessage }       from "./memory-briefing.js";

const logger = createLogger("session-rotate");


export class SessionRotateHandler {
  private readonly db:       Database;
  private readonly monitor:  TokenMonitor;
  private readonly briefer:  MemoryBriefingGenerator;

  constructor(db: Database) {
    this.db      = db;
    this.monitor = new TokenMonitor(db);
    this.briefer = new MemoryBriefingGenerator();
  }

  // -------------------------------------------------------------------------
  // rotate
  // -------------------------------------------------------------------------

  /**
   * Execute a full session rotation.
   *
   * @param oldSessionId  Session that has hit the rotate threshold
   * @param agentId       Agent ID
   * @param taskId        Task ID
   * @param model         Model ID (for new session context limit)
   * @param messages      Current full conversation messages
   * @param config        Agent SessionConfig (thresholds, briefing level, etc.)
   * @param taskTitle     Optional task title for the briefing header
   * @returns SessionRotationResult with fresh messages + checkpoint
   */
  async rotate(
    oldSessionId: string,
    agentId:      string,
    taskId:       string,
    model:        string,
    messages:     BriefingMessage[],
    config?:      SessionConfig,
    taskTitle?:   string,
  ): Promise<SessionRotationResult> {
    // 1. Transition old session to 'rotating'
    const canRotate = this.monitor.markRotating(oldSessionId);
    if (!canRotate) {
      logger.warn("session_rotate_skip", "Session already rotating/rotated — skipping", {
        metadata: { sessionId: oldSessionId, agentId },
      });
    }

    // 2. Get old session state (for checkpoint metadata)
    const oldState = this.monitor.getState(oldSessionId);
    const tokensAtRotation = oldState?.tokens_used    ?? 0;
    const turnAtRotation   = oldState?.turn_count     ?? 0;
    const sessionNumber    = this.monitor.getSessionCount(agentId, taskId);

    // 3. Generate briefing
    const briefingLevel: BriefingLevel = config?.briefing_level ?? "standard";
    const briefing = this.briefer.generate(
      messages,
      briefingLevel,
      taskTitle,
      sessionNumber,
    );

    // 4. Persist checkpoint
    const checkpoint = this._saveCheckpoint({
      sessionId:         oldSessionId,
      agentId,
      taskId,
      briefing,
      tokensAtRotation,
      turnAtRotation,
      sessionNumber,
    });

    // 5. Close old session
    this.monitor.closeSession(oldSessionId);

    logger.info("session_rotated", `Session ${oldSessionId} rotated → new session`, {
      metadata: {
        agentId,
        taskId,
        tokensAtRotation,
        turnAtRotation,
        briefingLevel,
        sessionNumber,
      },
    });

    // 6. Open new session
    const newSessionId = this.monitor.startSession(
      agentId,
      taskId,
      model,
      config?.context_window_tokens,
    );

    // 7. Build fresh message array: system prompt + briefing injection
    const systemMsg = messages.find((m) => m.role === "system");
    const freshMessages: BriefingMessage[] = [];
    if (systemMsg !== undefined) {
      freshMessages.push(systemMsg);
    }
    freshMessages.push({
      role:    "user",
      content: briefing,
    });
    freshMessages.push({
      role:    "assistant",
      content: "Understood. I have reviewed the session briefing and will continue the task from where we left off.",
    });

    return { checkpoint, fresh_messages: freshMessages, new_session_id: newSessionId };
  }

  // -------------------------------------------------------------------------
  // getLastCheckpoint
  // -------------------------------------------------------------------------

  /**
   * Retrieve the most recent SessionCheckpoint for an agent/task pair.
   * Returns null when no checkpoints exist (first session).
   */
  getLastCheckpoint(agentId: string, taskId: string): SessionCheckpoint | null {
    const row = this.db.prepare<[string, string], SessionCheckpoint>(`
      SELECT * FROM session_checkpoints
      WHERE agent_id = ? AND task_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(agentId, taskId);
    return row ?? null;
  }

  // -------------------------------------------------------------------------
  // listCheckpoints
  // -------------------------------------------------------------------------

  /**
   * Return all checkpoints for an agent/task pair, newest first.
   */
  listCheckpoints(agentId: string, taskId: string): SessionCheckpoint[] {
    return this.db.prepare<[string, string], SessionCheckpoint>(`
      SELECT * FROM session_checkpoints
      WHERE agent_id = ? AND task_id = ?
      ORDER BY created_at DESC
    `).all(agentId, taskId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _saveCheckpoint(params: {
    sessionId:         string;
    agentId:           string;
    taskId:            string;
    briefing:          string;
    tokensAtRotation:  number;
    turnAtRotation:    number;
    sessionNumber:     number;
  }): SessionCheckpoint {
    const id  = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare<[string, string, string, string, string, number, number, number, string], void>(`
      INSERT INTO session_checkpoints
        (id, session_id, agent_id, task_id, briefing,
         tokens_at_rotation, turn_at_rotation, session_number, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.sessionId,
      params.agentId,
      params.taskId,
      params.briefing,
      params.tokensAtRotation,
      params.turnAtRotation,
      params.sessionNumber,
      now,
    );

    return {
      id,
      session_id:          params.sessionId,
      agent_id:            params.agentId,
      task_id:             params.taskId,
      briefing:            params.briefing,
      tokens_at_rotation:  params.tokensAtRotation,
      turn_at_rotation:    params.turnAtRotation,
      session_number:      params.sessionNumber,
      created_at:          now,
    };
  }
}
