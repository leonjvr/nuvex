// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: Public API
 */

export { runCeoAssistantMigrations, CEO_ASSISTANT_MIGRATIONS } from "./migration.js";
export { AssistantTaskQueue }    from "./task-queue.js";
export { parseTaskIntent, isDienstschluss, formatTaskList } from "./task-intent.js";
export { CEO_ASSISTANT_GREETING, isFirstRun, hasAnyHistory } from "./greeting.js";
export { generateBriefing, detectTier }  from "./briefing.js";
export {
  generateDienstschlussSummary,
  persistDienstschlussCheckpoint,
  formatDienstschlussOutput,
} from "./dienstschluss.js";
export type {
  AssistantTask,
  AssistantTaskPriority,
  AssistantTaskStatus,
  CreateTaskInput,
  UpdateTaskInput,
  TaskListFilter,
  ParsedTaskIntent,
  TaskIntentType,
  SessionBriefing,
  BriefingTier,
  DienstschlussSummary,
} from "./types.js";
