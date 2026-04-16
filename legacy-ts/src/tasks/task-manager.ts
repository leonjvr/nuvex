// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.8: TaskManager
 *
 * Thin wrapper over TaskStore that adds input sanitization on createTask().
 * Existing code that uses TaskStore directly is unaffected.
 *
 * Usage:
 *   const manager = new TaskManager(store, sanitizer);
 *   const task = manager.createTask(input); // sanitizes description before insert
 */

import type { Task, CreateTaskInput } from "./types.js";
import type { TaskStore } from "./store.js";
import type { InputSanitizer } from "../core/input-sanitizer.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("task-manager");


export class TaskManager {
  constructor(
    private readonly store:     TaskStore,
    private readonly sanitizer: InputSanitizer | null = null,
  ) {}

  /**
   * Create a task, optionally sanitizing the description.
   *
   * If a sanitizer is configured in `block` mode and the description contains
   * injection patterns, throws SidjuaError INPUT-001 (or INPUT-002 for length).
   *
   * In `warn` mode, the task is created with a `sanitization_warnings` metadata
   * field recording the detected patterns.
   *
   * In `off` mode (or no sanitizer), behavior is identical to TaskStore.create().
   *
   * @throws SidjuaError if sanitizer is in block mode and input is dangerous
   */
  createTask(input: CreateTaskInput): Task {
    if (this.sanitizer !== null) {
      const result = this.sanitizer.sanitize(input.description);
      // result.blocked is only true when mode=block throws — so we never reach here.
      // Instead, we log warnings if any.
      if (result.warnings.length > 0) {
        logger.warn("input_sanitization_warning", "Sanitization warnings on task description", {
          metadata: {
            warning_count: result.warnings.length,
            warnings:      result.warnings.map((w) => w.detail),
          },
        });

        // Attach warnings to metadata
        const withWarnings: CreateTaskInput = {
          ...input,
          metadata: {
            ...(input.metadata ?? {}),
            sanitization_warnings: result.warnings,
          },
        };
        return this.store.create(withWarnings);
      }
    }

    return this.store.create(input);
  }

  /**
   * Expose remaining TaskStore methods directly.
   * This keeps TaskManager a thin wrapper rather than reimplementing everything.
   */
  get(id: string): Task | null {
    return this.store.get(id);
  }
}
