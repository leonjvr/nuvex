// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 186: MemoryBriefingGenerator
 *
 * Generates a compact memory briefing from a conversation history.
 * The briefing is injected at the start of a new session after context rotation
 * to preserve continuity without sending the full conversation.
 *
 * Three detail levels:
 *   minimal  — task goal + most recent outcome only (~200 tokens)
 *   standard — task goal + key decisions + last 3 exchanges (~500 tokens)
 *   detailed — task goal + full decision log + last 6 exchanges (~1000 tokens)
 */

import type { BriefingLevel } from "./types.js";


export interface BriefingMessage {
  role:    "system" | "user" | "assistant";
  content: string;
}


export class MemoryBriefingGenerator {
  /**
   * Generate a briefing string from a conversation history.
   *
   * @param messages    Full conversation messages at the point of rotation
   * @param level       Detail level for the briefing
   * @param taskTitle   Optional task title to include in the header
   * @param sessionNum  Session number (1-based) being closed
   * @returns Plain-text briefing ready to inject as a user message
   */
  generate(
    messages:   BriefingMessage[],
    level:      BriefingLevel = "standard",
    taskTitle?: string,
    sessionNum  = 1,
  ): string {
    const header = this._buildHeader(taskTitle, sessionNum);

    switch (level) {
      case "minimal":
        return header + this._buildMinimal(messages);
      case "detailed":
        return header + this._buildDetailed(messages);
      default:
        return header + this._buildStandard(messages);
    }
  }

  // -------------------------------------------------------------------------
  // Minimal (~200 tokens)
  // -------------------------------------------------------------------------

  private _buildMinimal(messages: BriefingMessage[]): string {
    const goal    = this._extractGoal(messages);
    const lastOut = this._lastAssistantContent(messages);
    const parts: string[] = ["## Task Goal", goal];
    if (lastOut) {
      parts.push("## Last Action", lastOut.slice(0, 400));
    }
    return parts.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Standard (~500 tokens)
  // -------------------------------------------------------------------------

  private _buildStandard(messages: BriefingMessage[]): string {
    const goal      = this._extractGoal(messages);
    const decisions = this._extractKeyDecisions(messages, 5);
    const recent    = this._recentExchanges(messages, 3);
    const parts: string[] = ["## Task Goal", goal];
    if (decisions.length > 0) {
      parts.push("## Key Decisions Made", decisions.map((d) => `- ${d}`).join("\n"));
    }
    if (recent.length > 0) {
      parts.push("## Recent Context", recent.join("\n\n"));
    }
    return parts.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Detailed (~1000 tokens)
  // -------------------------------------------------------------------------

  private _buildDetailed(messages: BriefingMessage[]): string {
    const goal      = this._extractGoal(messages);
    const decisions = this._extractKeyDecisions(messages, 15);
    const progress  = this._extractProgress(messages);
    const recent    = this._recentExchanges(messages, 6);
    const parts: string[] = ["## Task Goal", goal];
    if (progress) {
      parts.push("## Progress Summary", progress);
    }
    if (decisions.length > 0) {
      parts.push("## All Decisions Made", decisions.map((d, i) => `${i + 1}. ${d}`).join("\n"));
    }
    if (recent.length > 0) {
      parts.push("## Recent Exchanges", recent.join("\n\n"));
    }
    return parts.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Private extraction helpers
  // -------------------------------------------------------------------------

  private _buildHeader(taskTitle: string | undefined, sessionNum: number): string {
    const title = taskTitle ? ` — "${taskTitle}"` : "";
    return [
      `# Session Continuity Briefing (Session ${sessionNum}${title})`,
      "",
      "This briefing carries forward the context from the previous session.",
      "Continue the task from where it was left off.",
      "",
      "",
    ].join("\n");
  }

  /**
   * Extract the original task goal from the first user message.
   */
  private _extractGoal(messages: BriefingMessage[]): string {
    const firstUser = messages.find((m) => m.role === "user");
    if (firstUser === undefined) return "(no task goal found)";
    // Truncate long goals
    const content = firstUser.content;
    if (content.length <= 600) return content;
    return content.slice(0, 600) + "\n...(truncated)";
  }

  /**
   * Extract decisions from assistant messages that contain action keywords.
   */
  private _extractKeyDecisions(messages: BriefingMessage[], maxDecisions: number): string[] {
    const decisions: string[] = [];
    const actionKeywords = [
      "decided", "chose", "selected", "created", "deleted", "updated",
      "called tool", "result:", "completed", "found", "analysed",
    ];

    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const text = msg.content.trim();
      if (text.length < 10) continue;

      const lower = text.toLowerCase();
      const hasAction = actionKeywords.some((kw) => lower.includes(kw));
      if (!hasAction) continue;

      // Take first meaningful line
      const firstLine = text.split("\n").find((l) => l.trim().length > 20) ?? text;
      decisions.push(firstLine.slice(0, 200));

      if (decisions.length >= maxDecisions) break;
    }

    return decisions;
  }

  /**
   * Extract a one-paragraph progress summary from assistant messages.
   */
  private _extractProgress(messages: BriefingMessage[]): string | null {
    // Look for a message containing "progress", "summary", "completed" indicators
    for (const msg of [...messages].reverse()) {
      if (msg.role !== "assistant") continue;
      const lower = msg.content.toLowerCase();
      if (lower.includes("progress") || lower.includes("summary") || lower.includes("completed")) {
        return msg.content.slice(0, 800);
      }
    }
    return null;
  }

  /**
   * Return the last N user/assistant exchange pairs as formatted strings.
   */
  private _recentExchanges(messages: BriefingMessage[], maxPairs: number): string[] {
    // Skip system messages and work from the end
    const nonSystem = messages.filter((m) => m.role !== "system");
    const lastN     = nonSystem.slice(-maxPairs * 2);
    return lastN.map((m) => {
      const roleLabel = m.role === "user" ? "User" : "Agent";
      const snippet   = m.content.length > 400
        ? m.content.slice(0, 400) + " ...(truncated)"
        : m.content;
      return `**${roleLabel}:** ${snippet}`;
    });
  }

  /**
   * Return the last assistant message content, or null if none found.
   */
  private _lastAssistantContent(messages: BriefingMessage[]): string | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m !== undefined && m.role === "assistant" && m.content.trim().length > 0) {
        return m.content;
      }
    }
    return null;
  }
}
