// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11c: SSE Event Replay
 *
 * Replays missed events for reconnecting SSE clients.
 * Uses SQLite's implicit rowid as the monotonic integer event ID.
 *
 * Event ID strategy: task_events table has UUID primary keys but also has
 * SQLite's implicit rowid which is always monotonically increasing.
 * The SSE `Last-Event-ID` header carries this rowid.
 */

import type Database from "better-sqlite3";
import type { SSEEvent, SSEEventType } from "./event-filter.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("event-replay");


interface EventRow {
  rowid: number;
  event_type: string;
  task_id: string;
  agent_from: string | null;
  division: string;
  data: string;
  created_at: string;
}

type Db = InstanceType<typeof Database>;


const EVENT_TYPE_MAP: Record<string, SSEEventType> = {
  TASK_CREATED:            "task:created",
  TASK_ASSIGNED:           "task:assigned",
  TASK_STARTED:            "task:progress",
  TASK_PROGRESS:           "task:progress",
  RESULT_READY:            "task:completed",
  TASK_FAILED:             "task:failed",
  TASK_ESCALATED:          "task:failed",
  TASK_CANCELLED:          "task:cancelled",
  CONSULTATION_REQUEST:    "task:assigned",
  CONSULTATION_RESPONSE:   "task:progress",
  BUDGET_WARNING:          "cost:budget_warning",
  BUDGET_EXHAUSTED:        "cost:budget_exceeded",
  AGENT_CRASHED:           "agent:crashed",
  AGENT_RECOVERED:         "agent:restarted",
  HEARTBEAT_TIMEOUT:       "system:error",
  SYNTHESIS_READY:         "task:progress",
  PIPELINE_ACK_UPDATE:     "task:progress",
  CHECKPOINT_SAVED:        "task:progress",
  PROVIDER_CALL_COMPLETE:  "task:progress",
  TTL_WARNING:             "system:error",
};

function toSSEEventType(taskEventType: string): SSEEventType {
  return EVENT_TYPE_MAP[taskEventType] ?? "system:error";
}


/**
 * Fetch missed events from the task_events table since a given rowid.
 *
 * Used for:
 *   - Reconnection replay: client sends `Last-Event-ID`, we replay missed events.
 *   - Event poller: polls for new events since last seen rowid.
 *
 * @param db          Open SQLite database
 * @param lastEventId Last event rowid received by the client (0 = replay nothing)
 * @param maxEvents   Max number of events to return (default 1000)
 * @param maxAgeMs    Only include events newer than this age (null = no age limit)
 */
export function getReplaySince(
  db: Db,
  lastEventId: number,
  maxEvents = 1000,
  maxAgeMs: number | null = 300_000,
): SSEEvent[] {
  let rows: EventRow[] = [];

  try {
    if (maxAgeMs !== null) {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      rows = db
        .prepare<[number, string, number], EventRow>(
          `SELECT rowid, event_type, task_id, agent_from, division, data, created_at
           FROM task_events
           WHERE rowid > ? AND created_at > ?
           ORDER BY rowid ASC
           LIMIT ?`,
        )
        .all(lastEventId, cutoff, maxEvents);
    } else {
      rows = db
        .prepare<[number, number], EventRow>(
          `SELECT rowid, event_type, task_id, agent_from, division, data, created_at
           FROM task_events
           WHERE rowid > ?
           ORDER BY rowid ASC
           LIMIT ?`,
        )
        .all(lastEventId, maxEvents);
    }
  } catch (e: unknown) {
    logger.debug("event-replay", "task_events table not found — no events to replay (sidjua apply not run yet)", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return [];
  }

  const events: SSEEvent[] = [];
  for (const row of rows) {
    let parsedData: Record<string, unknown>;
    try {
      parsedData = JSON.parse(row.data) as Record<string, unknown>;
    } catch (parseErr) {
      logger.warn("event-replay", `Skipping corrupt event row (rowid=${row.rowid}): JSON.parse failed`, {
        metadata: { rowid: row.rowid, error: parseErr instanceof Error ? parseErr.message : String(parseErr) },
      });
      continue;
    }
    events.push({
      id:        row.rowid,
      type:      toSSEEventType(row.event_type),
      data:      {
        taskId:     row.task_id,
        agentId:    row.agent_from ?? undefined,
        divisionId: row.division,
        ...parsedData,
      },
      timestamp: row.created_at,
    });
  }
  return events;
}
