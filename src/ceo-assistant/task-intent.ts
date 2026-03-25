// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: Task Intent Parser
 *
 * Regex-based NLU for the free tier. Parses natural language into
 * structured task intents without requiring an LLM call.
 *
 * Handles:
 *   add_task       — "Remind me to X by Friday"
 *   list_tasks     — "What's on my list?" / "What's pending?"
 *   complete_task  — "Done with X" / "Mark X as done"
 *   cancel_task    — "Cancel X" / "Remove X from the list"
 *   overdue_tasks  — "What's overdue?" / "What am I late on?"
 *   update_priority — "Change priority of X to P1"
 *   dienstschluss  — "Dienstschluss" / "wrap up" / "end session"
 */

import type { ParsedTaskIntent, AssistantTaskPriority } from "./types.js";


// Dienstschluss / session end
const DIENSTSCHLUSS_PATTERNS = [
  /^dienstschluss\b/i,
  /\b(wrap\s+up|end\s+session|that'?s\s+it\s+for\s+today|let'?s\s+wrap|time\s+to\s+stop|end\s+of\s+day)\b/i,
  /^(bye|goodbye|ciao|done\s+for\s+today|finished\s+for\s+today)\b/i,
];

// List tasks
const LIST_TASKS_PATTERNS = [
  /\b(what'?s\s+on\s+my\s+(list|todo|plate)|show\s+(my\s+)?(tasks?|todo|list)|list\s+(my\s+)?tasks?)\b/i,
  /\b(what'?s?\s+pending|pending\s+tasks?|open\s+tasks?|show\s+open)\b/i,
  /\b(my\s+tasks?|task\s+list|todo\s+list)\b/i,
];

// Overdue tasks
const OVERDUE_PATTERNS = [
  /\b(what'?s?\s+(overdue|late|past\s+due|behind)|overdue\s+tasks?|late\s+tasks?)\b/i,
  /\b(what\s+am\s+i\s+late\s+on|missed\s+deadlines?|past\s+deadlines?)\b/i,
];

// Complete task
const COMPLETE_PATTERNS = [
  /^(done\s+with|finished\s+with|completed?|mark\s+as\s+done|crossed?\s+off)\s+(.+)$/i,
  /^mark\s+(.+?)\s+as\s+done$/i,
  /^(.+)\s+(is\s+done|is\s+complete[d]?|is\s+finished)$/i,
  /^(finished|done)\s*[:—-]\s*(.+)$/i,
];

// Cancel task
const CANCEL_PATTERNS = [
  /^(cancel|remove|delete|drop)\s+(.+)$/i,
  /^(.+)\s+(is\s+cancelled?|is\s+dropped?|won'?t\s+happen)$/i,
];

// Priority update
const PRIORITY_PATTERNS = [
  /\b(change|set|update)\s+priority\s+of\s+(.+?)\s+to\s+(P[1-4])\b/i,
  /\b(make|mark)\s+(.+?)\s+(P[1-4])\s+(priority|urgent|important)?\b/i,
];

// Add task with deadline
const ADD_TASK_DEADLINE_PATTERNS = [
  /^(remind\s+me\s+to|remember\s+to|add\s+task\s*[:—-]?)\s+(.+?)\s+by\s+(.+)$/i,
  /^(remind\s+me\s+to|remember\s+to)\s+(.+)$/i,
  /^(add|create)\s+(task\s*[:—-]?\s*)?(.+)$/i,
  /^(todo|to-do|task)\s*[:—-]\s*(.+)$/i,
];

// Priority from phrase
const PRIORITY_WORD_MAP: Record<string, AssistantTaskPriority> = {
  "P1": "P1", "P2": "P2", "P3": "P3", "P4": "P4",
  "critical": "P1", "urgent": "P1", "important": "P2",
  "high": "P2", "normal": "P3", "low": "P4", "background": "P4",
};


/**
 * Parse a user message into a structured task intent.
 *
 * @param message  Raw user input
 * @returns ParsedTaskIntent — type is "unknown" if no pattern matches
 */
export function parseTaskIntent(message: string): ParsedTaskIntent {
  const trimmed = message.trim();

  // 1. Dienstschluss
  for (const p of DIENSTSCHLUSS_PATTERNS) {
    if (p.test(trimmed)) return { type: "dienstschluss" };
  }

  // 2. Overdue tasks
  for (const p of OVERDUE_PATTERNS) {
    if (p.test(trimmed)) return { type: "overdue_tasks" };
  }

  // 3. List tasks
  for (const p of LIST_TASKS_PATTERNS) {
    if (p.test(trimmed)) return { type: "list_tasks" };
  }

  // 4. Complete task
  for (const p of COMPLETE_PATTERNS) {
    const m = trimmed.match(p);
    if (m !== null) {
      const title = (m[2] ?? m[1] ?? "").trim();
      if (title) return { type: "complete_task", title };
    }
  }

  // 5. Cancel task
  for (const p of CANCEL_PATTERNS) {
    const m = trimmed.match(p);
    if (m !== null) {
      const title = (m[2] ?? m[1] ?? "").trim();
      if (title) return { type: "cancel_task", title };
    }
  }

  // 6. Priority update
  for (const p of PRIORITY_PATTERNS) {
    const m = trimmed.match(p);
    if (m !== null) {
      const rawPri = (m[3] ?? m[3] ?? "P3").toUpperCase();
      const priority: AssistantTaskPriority = (PRIORITY_WORD_MAP[rawPri] ?? "P3") as AssistantTaskPriority;
      const title = (m[2] ?? "").trim();
      if (title) return { type: "update_priority", title, priority };
    }
  }

  // 7. Add task (with optional deadline)
  // "Remind me to check audit by Friday" → add_task with deadline
  const addMatch1 = trimmed.match(/^(remind\s+me\s+to|remember\s+to)\s+(.+?)\s+by\s+(.+)$/i);
  if (addMatch1 !== null) {
    return {
      type:     "add_task",
      title:    (addMatch1[2] ?? "").trim(),
      deadline: (addMatch1[3] ?? "").trim(),
    };
  }

  const addMatch2 = trimmed.match(/^(remind\s+me\s+to|remember\s+to)\s+(.+)$/i);
  if (addMatch2 !== null) {
    return { type: "add_task", title: (addMatch2[2] ?? "").trim() };
  }

  const addMatch3 = trimmed.match(/^(add|create)\s+(task\s*[:—-]?\s*)?(.+)$/i);
  if (addMatch3 !== null) {
    return { type: "add_task", title: (addMatch3[3] ?? "").trim() };
  }

  const addMatch4 = trimmed.match(/^(todo|to-do|task)\s*[:—-]\s*(.+)$/i);
  if (addMatch4 !== null) {
    return { type: "add_task", title: (addMatch4[2] ?? "").trim() };
  }

  return { type: "unknown" };
}


/**
 * Quick check if a user message is a Dienstschluss (session end) command.
 */
export function isDienstschluss(message: string): boolean {
  const trimmed = message.trim();
  return DIENSTSCHLUSS_PATTERNS.some((p) => p.test(trimmed));
}


/**
 * Format a list of tasks for display in the chat output.
 */
export function formatTaskList(tasks: Array<{ id: number; priority: string; title: string; deadline?: string; status: string }>): string {
  if (tasks.length === 0) return "No tasks found.";

  return tasks.map((t) => {
    const dl = t.deadline ? ` (by ${formatDate(t.deadline)})` : "";
    const flag = t.priority === "P1" ? " 🔴" : t.priority === "P2" ? " 🟠" : "";
    return `  [${t.id}] ${t.priority}${flag} — ${t.title}${dl}`;
  }).join("\n");
}

function formatDate(iso: string): string {
  // Return just the date portion for display
  return iso.slice(0, 10);
}
