// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: Session Start Briefing
 *
 * Generated on every non-first session start to orient the CEO Assistant.
 * Two tiers:
 *
 *   Free (provider = cloudflare):
 *     "Welcome back. Last time we worked on [X]. You have N open tasks. M are overdue."
 *
 *   Upgraded (any other provider):
 *     + Previous session summary
 *     + Today's tasks with deadlines
 *     + Overdue items with age
 *     + Open count breakdown by priority
 */

import type { Database }      from "../utils/db.js";
import type { SessionBriefing, BriefingTier, AssistantTask } from "./types.js";
import { AssistantTaskQueue } from "./task-queue.js";


/**
 * Detect whether we're running on the free tier (Cloudflare Workers AI)
 * or an upgraded tier.
 *
 * Logic: read the ceo-assistant agent_definitions row and check provider.
 * Cloudflare = free. Any other provider = upgraded.
 */
export function detectTier(db: Database, agentId = "ceo-assistant"): BriefingTier {
  try {
    const row = db.prepare<[string], { provider: string }>(
      "SELECT provider FROM agent_definitions WHERE id = ?",
    ).get(agentId);
    const provider = (row?.provider ?? "cloudflare").toLowerCase();
    if (provider === "cloudflare" || provider === "cloudflare-workers-ai") {
      return "free";
    }
    return "upgraded";
  } catch (_e) {
    return "free"; // safe default
  }
}


/**
 * Generate a session start briefing for the CEO Assistant.
 *
 * @param db       Open SQLite database
 * @param agentId  CEO Assistant agent ID (default: "ceo-assistant")
 * @param tier     Briefing detail level (auto-detected if not provided)
 */
export function generateBriefing(
  db:      Database,
  agentId = "ceo-assistant",
  tier?:   BriefingTier,
): SessionBriefing {
  const resolvedTier = tier ?? detectTier(db, agentId);
  const queue        = new AssistantTaskQueue(db);
  const stats        = queue.getStats(agentId);
  const lastCheckpoint = getLastSessionSummary(db, agentId);

  if (resolvedTier === "free") {
    return buildFreeBriefing(stats, lastCheckpoint, resolvedTier);
  }
  return buildUpgradedBriefing(db, agentId, queue, stats, lastCheckpoint);
}


function buildFreeBriefing(
  stats:          { open: number; overdue: number; done: number },
  lastCheckpoint: string | null,
  tier:           BriefingTier,
): SessionBriefing {
  const lines: string[] = ["Welcome back."];

  if (lastCheckpoint) {
    lines.push(`Last time we worked on: ${lastCheckpoint}`);
  }

  if (stats.open === 0) {
    lines.push("You have no open tasks.");
  } else {
    const overdueNote = stats.overdue > 0
      ? ` (${stats.overdue} overdue)`
      : "";
    lines.push(`You have ${stats.open} open task${stats.open !== 1 ? "s" : ""}${overdueNote}.`);
  }

  return {
    tier,
    text:          lines.join(" "),
    open_count:    stats.open,
    overdue_count: stats.overdue,
    ...(lastCheckpoint !== null ? { last_session: lastCheckpoint } : {}),
  };
}


function buildUpgradedBriefing(
  db:             Database,
  agentId:        string,
  queue:          AssistantTaskQueue,
  stats:          { open: number; overdue: number; done: number },
  lastCheckpoint: string | null,
): SessionBriefing {
  const sections: string[] = ["Welcome back."];

  // Previous session summary
  if (lastCheckpoint) {
    sections.push(`\n**Previous Session:**\n${lastCheckpoint}`);
  }

  // Overdue items (highlighted)
  const overdueTasks = queue.getOverdueTasks(agentId);
  if (overdueTasks.length > 0) {
    const items = overdueTasks
      .map((t) => `  - [${t.id}] ${t.title} (due ${formatDeadline(t.deadline, db)})`)
      .join("\n");
    sections.push(`\n**Overdue (${overdueTasks.length}):**\n${items}`);
  }

  // Today's tasks
  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = queue.listTasks(agentId, { status: "open" }).filter(
    (t) => t.deadline !== undefined && t.deadline.slice(0, 10) === today,
  );
  if (todayTasks.length > 0) {
    const items = todayTasks.map((t) => `  - [${t.id}] ${t.priority} ${t.title}`).join("\n");
    sections.push(`\n**Due Today:**\n${items}`);
  }

  // Open task count by priority
  if (stats.open > 0) {
    const openTasks = queue.listTasks(agentId, { status: "open" });
    const byPriority = countByPriority(openTasks);
    const breakdown = ["P1","P2","P3","P4"]
      .filter((p) => (byPriority[p] ?? 0) > 0)
      .map((p) => `${p}: ${byPriority[p]}`)
      .join(", ");
    sections.push(`\n**Open Tasks:** ${stats.open} (${breakdown})`);
  } else {
    sections.push("\n**Open Tasks:** none");
  }

  const text = sections.join("\n");

  return {
    tier:          "upgraded",
    text,
    open_count:    stats.open,
    overdue_count: stats.overdue,
    ...(lastCheckpoint !== null ? { last_session: lastCheckpoint } : {}),
  };
}


/**
 * Fetch the last session checkpoint briefing text for this agent.
 * Returns the first 300 chars or null if no checkpoint exists.
 */
function getLastSessionSummary(db: Database, agentId: string): string | null {
  try {
    const row = db.prepare<[string], { briefing: string }>(`
      SELECT briefing FROM session_checkpoints
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(agentId);

    if (row === undefined) return null;

    // Extract first meaningful paragraph from the briefing
    const lines = row.briefing.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    if (lines.length === 0) return null;

    const summary = lines.slice(0, 3).join(" ").trim();
    return summary.length > 300 ? summary.slice(0, 300) + "..." : summary;
  } catch (_e) {
    return null;
  }
}

function countByPriority(tasks: AssistantTask[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    counts[t.priority] = (counts[t.priority] ?? 0) + 1;
  }
  return counts;
}

function formatDeadline(deadline: string | undefined, _db: Database): string {
  if (deadline === undefined) return "no deadline";
  const date = new Date(deadline);
  const now  = new Date();
  const diffMs  = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return deadline.slice(0, 10);
  return `${deadline.slice(0, 10)}, ${diffDays}d ago`;
}
