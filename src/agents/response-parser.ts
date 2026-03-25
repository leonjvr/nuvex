// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: Agent Response Parser
 *
 * Parses structured LLM responses from agent task execution.
 * This is the most bug-prone area — handles diverse response formats.
 *
 * Expected format:
 *
 *   DECISION: EXECUTE | DECOMPOSE
 *
 *   If EXECUTE:
 *   RESULT:
 *   [content]
 *   SUMMARY:
 *   [2-5 sentences]
 *   CONFIDENCE: 0.XX
 *
 *   If DECOMPOSE:
 *   PLAN:
 *   - Sub-task 1: [title] — [description] — [tier: N]
 *   - Sub-task 2: ...
 */

import type { AgentDecision, SubTaskPlan } from "./types.js";


/**
 * Parse a structured agent response from LLM output.
 * Returns null if the response cannot be parsed.
 *
 * Handles variations:
 * - Case-insensitive section headers
 * - Optional whitespace around separators
 * - Missing optional fields (defaults applied)
 * - Both "—" (em dash) and "--" as separators in plan lines
 */
export function parseAgentResponse(text: string): AgentDecision | null {
  if (!text || text.trim().length === 0) return null;

  // Find DECISION line (case-insensitive, anywhere in text)
  const decisionMatch = text.match(/DECISION\s*:\s*(EXECUTE|DECOMPOSE)/i);
  if (!decisionMatch) return null;

  const decision = decisionMatch[1]!.toUpperCase().trim();

  if (decision === "EXECUTE") {
    return parseExecuteResponse(text);
  } else if (decision === "DECOMPOSE") {
    return parseDecomposeResponse(text);
  }

  return null;
}


function parseExecuteResponse(text: string): AgentDecision | null {
  // Extract RESULT section
  // Matches: RESULT: (newline) [content] until SUMMARY: or CONFIDENCE:
  const resultMatch = text.match(
    /RESULT\s*:\s*\n([\s\S]*?)(?=SUMMARY\s*:|CONFIDENCE\s*:|$)/i,
  );

  // Extract SUMMARY section
  const summaryMatch = text.match(
    /SUMMARY\s*:\s*\n([\s\S]*?)(?=CONFIDENCE\s*:|RESULT\s*:|$)/i,
  );

  // Extract CONFIDENCE value
  const confidenceMatch = text.match(
    /CONFIDENCE\s*:\s*(\d+(?:\.\d+)?)/i,
  );

  // SUMMARY is required
  if (!summaryMatch) return null;

  const result = resultMatch ? resultMatch[1]!.trim() : "";
  const summary = summaryMatch[1]!.trim();

  // Parse confidence
  let confidence = 0.8; // default if missing
  if (confidenceMatch) {
    const parsed = parseFloat(confidenceMatch[1]!);
    if (!isNaN(parsed)) {
      confidence = Math.min(1.0, Math.max(0.0, parsed));
    }
  }

  return { decision: "EXECUTE", result, summary, confidence };
}


function parseDecomposeResponse(text: string): AgentDecision | null {
  // Find PLAN: section
  const planMatch = text.match(/PLAN\s*:\s*\n([\s\S]*?)(?=DECISION\s*:|$)/i);
  if (!planMatch) return null;

  const planText = planMatch[1]!;
  const lines = planText.split("\n").filter((l) => l.trim().length > 0);

  const subtasks: SubTaskPlan[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Must start with a list marker
    if (!trimmed.startsWith("-") && !trimmed.match(/^\d+\./)) continue;

    // Remove leading list marker
    const content = trimmed.replace(/^[-*]\s*|^\d+\.\s*/, "").trim();

    const parsed = parseSubTaskLine(content);
    if (parsed !== null) {
      subtasks.push(parsed);
    }
  }

  // Need at least one valid subtask
  if (subtasks.length === 0) return null;

  return { decision: "DECOMPOSE", plan: subtasks };
}

/**
 * Parse a single sub-task line in format:
 * "Title — Description — [tier: N]"
 * or "Title -- Description -- [tier: N]"
 * or "Title: Description (tier N)"
 *
 * Accepts both em dash (—) and double dash (--) as separator.
 * Tier can be specified as "[tier: N]", "tier: N", "(tier N)", etc.
 */
function parseSubTaskLine(line: string): SubTaskPlan | null {
  // Try: "Title — Description — [tier: N]" format
  // Em dash (—) or "--" separator
  const dashSep = line.includes("—") ? "—" : "--";
  const parts = line.split(dashSep).map((p) => p.trim());

  if (parts.length >= 2) {
    const title = parts[0]!.trim();
    // Last part might contain tier
    const lastPart = parts[parts.length - 1]!;
    const descParts = parts.slice(1, -1);

    // Try to extract tier from last part
    const tierInLast = extractTier(lastPart);

    if (tierInLast !== null) {
      // Last part is tier spec, description is everything in between
      const description =
        descParts.length > 0
          ? descParts.join(dashSep).trim()
          : stripTierSpec(lastPart);

      if (title && description) {
        return { title, description, tier: tierInLast };
      }
    } else {
      // Try extracting tier from anywhere in the full line
      const tierFromFull = extractTier(line);
      if (tierFromFull !== null && parts.length >= 2) {
        const description = parts.slice(1).join(dashSep).replace(/\[?tier\s*:\s*\d\]?/i, "").trim();
        if (title && description) {
          return { title, description, tier: tierFromFull };
        }
      }

      // No tier found — default to tier 3 (worker)
      if (parts.length >= 2) {
        const description = parts.slice(1).join(dashSep).trim();
        if (title && description) {
          return { title, description, tier: 3 };
        }
      }
    }
  }

  // Try: "Title: Description" format (simpler)
  const colonIdx = line.indexOf(":");
  if (colonIdx > 0) {
    const title = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();
    const tier = extractTier(rest) ?? 3;
    const description = stripTierSpec(rest).trim() || rest.trim();
    if (title && description) {
      return { title, description, tier };
    }
  }

  return null;
}

/** Extract tier number from text. Returns null if not found. */
function extractTier(text: string): 1 | 2 | 3 | null {
  // Matches: [tier: 2], tier: 2, (tier 2), tier=2
  const match = text.match(/\[?\s*tier\s*[:\s=]\s*([123])\s*\]?/i);
  if (!match) return null;
  const n = parseInt(match[1]!, 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

/** Remove tier specification from a string. */
function stripTierSpec(text: string): string {
  return text.replace(/\[?\s*tier\s*[:\s=]\s*[123]\s*\]?/gi, "").trim();
}
