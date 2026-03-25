// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Structured logger
 *
 * All library code MUST use this logger instead of console.log.
 * Log entries are structured JSON: { level, timestamp, step, message, data? }
 *
 * The handler is injectable for testing and custom transports.
 */

import type { ApplyStep } from "../types/apply.js";


export type LogLevel = "debug" | "info" | "warn" | "error";

/** Valid step names (apply steps + runtime context identifiers). */
export type LogStep =
  | ApplyStep
  | "SYSTEM"
  | "PROVIDER"
  | "TASK"
  | "AGENT"
  // Phase 9: Orchestrator
  | "ORCHESTRATOR"
  | "DISTRIBUTOR"
  | "ESCALATION"
  | "SYNTHESIS"
  | "PEER_ROUTER"
  // Phase 9.5: Task Pipeline
  | "PIPELINE"
  | "PIPELINE_QUEUE"
  | "ACK_TRACKER"
  | "BACKPRESSURE"
  // Phase 10.5: Agent Lifecycle
  | "AGENT_LIFECYCLE"
  // Phase 10.5c: Process Resilience
  | "SUPERVISOR"
  | "CHECKPOINT"
  | "WAL"
  | "RECOVERY";

export interface LogEntry {
  level: LogLevel;
  /** ISO 8601 timestamp */
  timestamp: string;
  step: LogStep;
  message: string;
  data?: Record<string, unknown>;
}

export type LogHandler = (entry: LogEntry) => void;


function defaultHandler(entry: LogEntry): void {
  const obj: Record<string, unknown> = {
    level: entry.level,
    timestamp: entry.timestamp,
    step: entry.step,
    message: entry.message,
  };
  if (entry.data !== undefined) {
    obj["data"] = entry.data;
  }
  const line = JSON.stringify(obj) + "\n";

  if (entry.level === "error" || entry.level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}


/**
 * Structured logger. Inject a custom handler for testing or custom transports.
 *
 * @example
 * const log = new Logger();
 * log.info("VALIDATE", "Parsing divisions.yaml", { path: "/foo/divisions.yaml" });
 *
 * @example
 * // Silence in tests:
 * const log = new Logger(() => {});
 */
export class Logger {
  private readonly handler: LogHandler;

  constructor(handler: LogHandler = defaultHandler) {
    this.handler = handler;
  }

  /** Create a new Logger with a different handler, preserving the class shape. */
  withHandler(handler: LogHandler): Logger {
    return new Logger(handler);
  }

  /** Create a no-op logger (useful in tests). */
  static silent(): Logger {
    return new Logger(() => undefined);
  }

  debug(step: LogStep, message: string, data?: Record<string, unknown>): void {
    this.emit("debug", step, message, data);
  }

  info(step: LogStep, message: string, data?: Record<string, unknown>): void {
    this.emit("info", step, message, data);
  }

  warn(step: LogStep, message: string, data?: Record<string, unknown>): void {
    this.emit("warn", step, message, data);
  }

  error(step: LogStep, message: string, data?: Record<string, unknown>): void {
    this.emit("error", step, message, data);
  }

  private emit(
    level: LogLevel,
    step: LogStep,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      step,
      message,
    };
    if (data !== undefined) {
      entry.data = data;
    }
    this.handler(entry);
  }
}

/** Default module-level logger instance. Replace handler at entry point if needed. */
export const logger = new Logger();
