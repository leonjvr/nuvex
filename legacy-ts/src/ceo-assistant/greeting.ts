// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: First-Run Greeting
 *
 * Displayed only on the very first interaction with a fresh workspace.
 * Subsequent sessions receive the session briefing instead.
 */

import type { Database } from "../utils/db.js";


/** Displayed on the FIRST EVER interaction (no previous session checkpoints). */
export const CEO_ASSISTANT_GREETING = `Welcome. I'm your CEO Assistant — your first employee at your new company.

SIDJUA gives you a fully equipped, secure office building with backup, documentation, and communication infrastructure. But the company is yours. You hire your agents, train them, define workflows, and correct them when things go wrong.

But be aware — some doors are still missing. Some are there, but where are the keys? And some elevator shafts are open but empty. So please — tell us what's not working or missing so we can implement it. (But like always, enhancements or design changes may come with additional costs...)

You're standing on day one of your new company. I can help you set up everything: create agents, configure providers, define governance rules, and troubleshoot problems. I also keep track of your tasks, remind you of deadlines, and remember what we've worked on together.

Right now I'm running on a free model — great for getting started and basic tasks. For full assistant capabilities like better memory and smarter planning, you'll want a more capable model. I'll explain how to set that up when you're ready.

What would you like to do first?`;


/**
 * Returns true if this is the very first interaction for the given agent.
 *
 * Detection method: check for any session checkpoints in `session_checkpoints`.
 * If the table doesn't exist yet or has no rows for this agent → first run.
 */
export function isFirstRun(db: Database, agentId: string): boolean {
  try {
    const row = db.prepare<[string], { cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM session_checkpoints WHERE agent_id = ?
    `).get(agentId);
    return (row?.cnt ?? 0) === 0;
  } catch (_e) {
    // Table doesn't exist yet (session migration not run) → treat as first run
    return true;
  }
}

/**
 * Returns true if the CEO Assistant has any chat history at all.
 * Uses the assistant_tasks table as a proxy (tasks exist → not first run).
 * Falls back to session_checkpoints check.
 */
export function hasAnyHistory(db: Database, agentId: string): boolean {
  try {
    const row = db.prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM assistant_tasks WHERE agent_id = ?",
    ).get(agentId);
    if ((row?.cnt ?? 0) > 0) return true;
  } catch (_e) { /* table may not exist */ }

  return !isFirstRun(db, agentId);
}
