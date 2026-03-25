// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 186: Agent Session Lifecycle Types (Tier 1)
 *
 * Defines the data model for token-aware session management.
 * Every agent session tracks context window usage; when thresholds are reached
 * the session rotates: a memory briefing carries key context into the fresh session.
 */


export interface SessionConfig {
  /** Model context window limit in tokens. Defaults to model-specific value. */
  context_window_tokens?: number;

  /**
   * Percentage of context window at which a "warn" event is emitted.
   * Default: 70 (70%)
   */
  warn_threshold_percent?: number;

  /**
   * Percentage of context window at which the session rotates (context reset).
   * Default: 85 (85%)
   */
  rotate_threshold_percent?: number;

  /**
   * Detail level for the memory briefing generated at session rotation.
   * Default: "standard"
   */
  briefing_level?: "minimal" | "standard" | "detailed";

  /**
   * Force session rotation after this many turns regardless of token count.
   * 0 or undefined = disabled. Default: 0 (disabled)
   */
  max_session_turns?: number;
}


export type SessionStatus = "active" | "warned" | "rotating" | "rotated";


export interface SessionTokenState {
  /** UUID for this session. */
  session_id: string;

  /** Agent that owns this session. */
  agent_id: string;

  /** Task for which this session was opened. */
  task_id: string;

  /** Total tokens accumulated this session (input + output). */
  tokens_used: number;

  /** Model context window limit used for threshold calculations. */
  context_limit: number;

  /** tokens_used / context_limit × 100. */
  percent_used: number;

  /** Number of reasoning turns recorded this session. */
  turn_count: number;

  /** ISO-8601 timestamp when the session was opened. */
  started_at: string;

  /** ISO-8601 timestamp of the last token record. */
  last_updated: string;

  /** Current lifecycle status of this session. */
  status: SessionStatus;
}


export interface SessionCheckpoint {
  /** UUID for this checkpoint record. */
  id: string;

  /** Session that was rotated. */
  session_id: string;

  /** Agent that owns the session. */
  agent_id: string;

  /** Task being processed when rotation occurred. */
  task_id: string;

  /** The generated briefing text injected into the new session. */
  briefing: string;

  /** Total tokens at the moment of rotation. */
  tokens_at_rotation: number;

  /** Turn number at the moment of rotation. */
  turn_at_rotation: number;

  /** Number of the session (1-based, increments per agent per task). */
  session_number: number;

  /** ISO-8601 timestamp. */
  created_at: string;
}


export type SessionAuditEvent =
  | "session_started"
  | "tokens_recorded"
  | "warn_threshold_reached"
  | "rotate_threshold_reached"
  | "session_rotated"
  | "session_closed";

export interface SessionAuditEntry {
  id: string;
  session_id: string;
  agent_id: string;
  event: SessionAuditEvent;
  tokens_at_event: number;
  percent_at_event: number;
  detail?: string;
  created_at: string;
}


export type ThresholdAction = "ok" | "warn" | "rotate";

export interface ThresholdCheckResult {
  action: ThresholdAction;
  percent_used: number;
  tokens_used: number;
  context_limit: number;
  warn_at: number;
  rotate_at: number;
}


export interface SessionRotationResult {
  /** The newly created checkpoint with the briefing. */
  checkpoint: SessionCheckpoint;

  /**
   * Fresh message array for the new session:
   * [system prompt (unchanged), briefing user message]
   */
  fresh_messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;

  /** Newly opened session ID. */
  new_session_id: string;
}


export type BriefingLevel = "minimal" | "standard" | "detailed";


/**
 * Default context window sizes (tokens) for known models.
 * Used when the agent YAML does not specify context_window_tokens.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  "claude-opus-4-6":                    200_000,
  "claude-sonnet-4-6":                  200_000,
  "claude-sonnet-4-5":                  200_000,
  "claude-haiku-4-5-20251001":          200_000,
  "claude-haiku-4-5":                   200_000,
  "claude-3-5-sonnet-20241022":         200_000,
  "claude-3-5-haiku-20241022":          200_000,
  "claude-3-opus-20240229":             200_000,

  // OpenAI
  "gpt-4o":                             128_000,
  "gpt-4o-mini":                        128_000,
  "gpt-4-turbo":                        128_000,
  "gpt-4":                                8_192,
  "gpt-3.5-turbo":                       16_384,
  "o1":                                 200_000,
  "o3-mini":                            200_000,

  // Cloudflare Workers AI
  "@cf/meta/llama-3.1-8b-instruct":      32_768,
  "@cf/meta/llama-3.3-70b-instruct-fp8": 32_768,
  "@cf/mistral/mistral-7b-instruct-v0.2": 32_768,

  // Google
  "gemini-2.0-flash":                 1_048_576,
  "gemini-1.5-pro":                   2_097_152,
  "gemini-1.5-flash":                 1_048_576,

  // Groq (fast inference)
  "llama-3.1-8b-instant":               131_072,
  "llama-3.3-70b-versatile":            131_072,
  "mixtral-8x7b-32768":                  32_768,

  // DeepSeek
  "deepseek-chat":                      163_840,
  "deepseek-reasoner":                  163_840,
};

/** Fallback context window when model is unknown (conservative). */
export const DEFAULT_CONTEXT_WINDOW = 32_768;

/**
 * Look up the context window for a model by ID.
 * Falls back to DEFAULT_CONTEXT_WINDOW when not found.
 */
export function resolveContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}
