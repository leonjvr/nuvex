// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: Task System
 *
 * Public API barrel. Import from here for all task system components.
 */

// Types
export type {
  Task,
  CreateTaskInput,
  TaskStatus,
  TaskType,
  TaskEvent,
  TaskEventType,
  TaskEventInput,
  ManagementSummary,
  ResultFrontmatter,
  TaskTreeNode,
  AgentTodoList,
  TransitionContext,
  ValidationResult,
  IPCChannel,
  EmbeddingProvider,
  EmbeddingResult,
} from "./types.js";

export { DEFAULT_TTL_SECONDS, NoOpEmbeddingProvider } from "./types.js";

// Core components
export { TaskStore }         from "./store.js";
export { TaskEventBus }      from "./event-bus.js";
export { TaskStateMachine }  from "./state-machine.js";
export { TaskQueue }         from "./queue.js";
export { TaskTree }          from "./tree.js";
export { ResultStore }       from "./result-store.js";
export { TaskRouter }        from "./router.js";
export { DecompositionValidator } from "./decomposition.js";
