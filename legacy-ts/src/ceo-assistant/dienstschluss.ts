// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: Dienstschluss (Session Wrap-Up)
 *
 * When the user says "Dienstschluss", "wrap up", "end session", etc.:
 *   1. Summarize current session: what was discussed, tasks created/completed
 *   2. Write a comprehensive checkpoint to SQLite (session_checkpoints via P186)
 *   3. List open tasks and next priorities
 *   4. Return a friendly sign-off message
 *
 * This is NOT the same as SESSION_ROTATE (which is automatic on context limits).
 * Dienstschluss is always user-initiated.
 */

import { randomUUID } from "node:crypto";
import type { Database }        from "../utils/db.js";
import type { DienstschlussSummary, AssistantTask } from "./types.js";
import { AssistantTaskQueue }   from "./task-queue.js";
import type { BriefingMessage } from "../session/memory-briefing.js";


/**
 * Generate a Dienstschluss summary from the current session.
 *
 * @param messages  Current conversation messages
 * @param db        Open SQLite database
 * @param agentId   CEO Assistant agent ID
 * @param taskId    Optional task ID if a session was opened
 */
export function generateDienstschlussSummary(
  messages: BriefingMessage[],
  db:       Database,
  agentId:  string,
): DienstschlussSummary {
  const queue = new AssistantTaskQueue(db);
  const stats = queue.getStats(agentId);
  const openTasks = queue.listTasks(agentId, { status: "open" });

  // Count tasks created/completed in this session (best effort from message history)
  const { created, completed } = countSessionTaskActivity(messages);

  const sessionSummary = buildSessionSummary(messages);

  const signOff = buildSignOff(openTasks, stats.overdue);

  return {
    session_summary:     sessionSummary,
    tasks_created:       created,
    tasks_completed:     completed,
    open_tasks_snapshot: openTasks,
    sign_off:            signOff,
  };
}


/**
 * Write a Dienstschluss checkpoint to the session_checkpoints table.
 * Returns the checkpoint ID.
 */
export function persistDienstschlussCheckpoint(
  db:      Database,
  agentId: string,
  taskId:  string,
  summary: DienstschlussSummary,
  turnCount: number,
): string {
  const id       = randomUUID();
  const now      = new Date().toISOString();
  const briefing = formatCheckpointBriefing(summary);

  try {
    // Dienstschluss checkpoints are not tied to an active session_token_usage row,
    // so disable FK enforcement for this best-effort insert.
    db.pragma("foreign_keys = OFF");
    db.prepare<[string, string, string, string, string, number, string], void>(`
      INSERT INTO session_checkpoints
        (id, session_id, agent_id, task_id, briefing,
         tokens_at_rotation, turn_at_rotation, session_number, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?)
    `).run(id, "dienstschluss-" + id, agentId, taskId, briefing, turnCount, now);
    db.pragma("foreign_keys = ON");
  } catch (_e) {
    // Non-fatal — table may not be migrated yet
    try { db.pragma("foreign_keys = ON"); } catch (_e2) { /* ignore */ }
  }

  return id;
}


/**
 * Format the Dienstschluss summary for display in the chat output.
 */
export function formatDienstschlussOutput(summary: DienstschlussSummary): string {
  const lines: string[] = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  Dienstschluss — Session Wrap-Up",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  if (summary.session_summary) {
    lines.push("Session summary:");
    lines.push(summary.session_summary);
    lines.push("");
  }

  if (summary.tasks_created > 0 || summary.tasks_completed > 0) {
    lines.push(
      `Tasks this session: ${summary.tasks_created} added, ${summary.tasks_completed} completed`,
    );
    lines.push("");
  }

  if (summary.open_tasks_snapshot.length > 0) {
    lines.push(`Open tasks (${summary.open_tasks_snapshot.length}):`);
    for (const t of summary.open_tasks_snapshot.slice(0, 10)) {
      const dl = t.deadline ? ` — due ${t.deadline.slice(0, 10)}` : "";
      lines.push(`  [${t.id}] ${t.priority} ${t.title}${dl}`);
    }
    if (summary.open_tasks_snapshot.length > 10) {
      lines.push(`  ... and ${summary.open_tasks_snapshot.length - 10} more`);
    }
    lines.push("");
  }

  lines.push(summary.sign_off);
  lines.push("");

  return lines.join("\n");
}


function countSessionTaskActivity(messages: BriefingMessage[]): { created: number; completed: number } {
  let created = 0;
  let completed = 0;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const lower = msg.content.toLowerCase();
    if (lower.includes("added task") || lower.includes("task added") || lower.includes("created task")) {
      created++;
    }
    if (lower.includes("marked as done") || lower.includes("completed task") || lower.includes("task done")) {
      completed++;
    }
  }

  return { created, completed };
}

function buildSessionSummary(messages: BriefingMessage[]): string {
  // Look for meaningful assistant responses (skip short/system messages)
  const assistantMsgs = messages
    .filter((m) => m.role === "assistant" && m.content.trim().length > 50)
    .slice(-5);  // last 5 meaningful responses

  if (assistantMsgs.length === 0) return "Short session — nothing significant to summarize.";

  // Take the last meaningful assistant message as the session summary
  const last = assistantMsgs[assistantMsgs.length - 1];
  if (last === undefined) return "Session completed.";

  const content = last.content.trim();
  return content.length > 500 ? content.slice(0, 500) + "..." : content;
}

function buildSignOff(openTasks: AssistantTask[], overdueCount: number): string {
  const parts: string[] = ["Session checkpoint saved."];

  if (overdueCount > 0) {
    parts.push(`${overdueCount} overdue item${overdueCount !== 1 ? "s" : ""} need attention tomorrow.`);
  }

  if (openTasks.length > 0) {
    const topTask = openTasks.find((t) => t.priority === "P1") ?? openTasks[0];
    if (topTask !== undefined) {
      parts.push(`Top priority next: "${topTask.title}".`);
    }
  }

  parts.push("Goodbye!");

  return parts.join(" ");
}

function formatCheckpointBriefing(summary: DienstschlussSummary): string {
  const lines = [
    "# Dienstschluss Checkpoint",
    "",
    "## Session Summary",
    summary.session_summary,
    "",
    `Tasks created: ${summary.tasks_created}`,
    `Tasks completed: ${summary.tasks_completed}`,
    "",
  ];

  if (summary.open_tasks_snapshot.length > 0) {
    lines.push("## Open Tasks at Close");
    for (const t of summary.open_tasks_snapshot.slice(0, 20)) {
      const dl = t.deadline ? ` (${t.deadline.slice(0, 10)})` : "";
      lines.push(`- [${t.id}] ${t.priority} ${t.title}${dl}`);
    }
  }

  return lines.join("\n");
}
