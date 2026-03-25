// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: TaskTree
 *
 * Hierarchy navigation and ASCII tree formatter.
 * V1 max depth = 3 (T1→T2→T3). DecompositionValidator enforces this.
 */

import type { Task, TaskTreeNode } from "./types.js";
import type { TaskStore } from "./store.js";

export class TaskTree {
  constructor(private readonly store: TaskStore) {}

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /** Direct children of a task. */
  getChildren(taskId: string): Task[] {
    return this.store.getByParent(taskId);
  }

  /** Immediate parent, or null if root. */
  getParent(taskId: string): Task | null {
    const task = this.store.get(taskId);
    if (task === null || task.parent_id === null) return null;
    return this.store.get(task.parent_id);
  }

  /**
   * The root task (where parent_id is null and root_id === id).
   * Walks up via parent chain as fallback.
   */
  getRoot(taskId: string): Task {
    const task = this.store.get(taskId);
    if (task === null) throw new Error(`Task not found: ${taskId}`);
    const root = this.store.get(task.root_id);
    if (root !== null) return root;
    // Fallback: walk up via parent chain
    return this.walkToRoot(task);
  }

  /** Sibling tasks (same parent, excluding self). */
  getSiblings(taskId: string): Task[] {
    const task = this.store.get(taskId);
    if (task === null || task.parent_id === null) return [];
    return this.store
      .getByParent(task.parent_id)
      .filter((t) => t.id !== taskId);
  }

  /**
   * Path from task up to root (inclusive), ordered parent-first.
   * E.g. [root, mid, task] for a 3-level hierarchy.
   */
  getAncestors(taskId: string): Task[] {
    const ancestors: Task[] = [];
    let current = this.store.get(taskId);
    while (current !== null && current.parent_id !== null) {
      const parent = this.store.get(current.parent_id);
      if (parent === null) break;
      ancestors.unshift(parent);
      current = parent;
    }
    return ancestors;
  }

  // ---------------------------------------------------------------------------
  // Full tree
  // ---------------------------------------------------------------------------

  /** Build the complete tree rooted at rootId. */
  getFullTree(rootId: string): TaskTreeNode {
    const root = this.store.get(rootId);
    if (root === null) throw new Error(`Root task not found: ${rootId}`);
    return this.buildSubTree(root, 0);
  }

  /** Build a sub-tree rooted at taskId. */
  getSubTree(taskId: string): TaskTreeNode {
    const task = this.store.get(taskId);
    if (task === null) throw new Error(`Task not found: ${taskId}`);
    return this.buildSubTree(task, 0);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Depth of a task in the hierarchy (root = 0). */
  getDepth(taskId: string): number {
    const task = this.store.get(taskId);
    if (task === null) throw new Error(`Task not found: ${taskId}`);
    const ancestors = this.getAncestors(taskId);
    return ancestors.length;
  }

  /**
   * All leaf tasks in the tree — tasks with no children.
   */
  getLeafTasks(rootId: string): Task[] {
    const all = this.store.getByRoot(rootId);
    const parentIds = new Set(
      all.filter((t) => t.parent_id !== null).map((t) => t.parent_id as string),
    );
    return all.filter((t) => !parentIds.has(t.id));
  }

  /** Sub-tasks of a task that are still pending (not yet complete). */
  getPendingSubTasks(taskId: string): Task[] {
    return this.store
      .getByParent(taskId)
      .filter(
        (t) => t.status !== "DONE" && t.status !== "CANCELLED" && t.status !== "FAILED",
      );
  }

  // ---------------------------------------------------------------------------
  // Display
  // ---------------------------------------------------------------------------

  /**
   * ASCII tree representation.
   *
   * Example:
   *   [DONE] Task abc123 — "Implement user auth" (T1, confidence: 0.92)
   *   ├── [DONE] Task def456 — "Design auth API" (T2, confidence: 0.95)
   *   │   └── [DONE] Task ghi789 — "Write JWT" (T3, confidence: 0.98)
   *   └── [RUNNING] Task mno345 — "Write tests" (T2)
   */
  formatHierarchy(rootId: string): string {
    const tree = this.getFullTree(rootId);
    const lines: string[] = [];
    this.formatNode(tree, "", true, lines, true);
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildSubTree(task: Task, depth: number): TaskTreeNode {
    const children = this.store.getByParent(task.id);
    return {
      task,
      children: children.map((child) => this.buildSubTree(child, depth + 1)),
      depth,
    };
  }

  private walkToRoot(task: Task): Task {
    let current = task;
    while (current.parent_id !== null) {
      const parent = this.store.get(current.parent_id);
      if (parent === null) break;
      current = parent;
    }
    return current;
  }

  private formatNode(
    node: TaskTreeNode,
    prefix: string,
    isRoot: boolean,
    lines: string[],
    isLast: boolean,
  ): void {
    const { task, children } = node;
    const shortId = task.id.slice(0, 6);
    const tier = `T${task.tier}`;
    const confidence =
      task.confidence !== null ? `, confidence: ${task.confidence.toFixed(2)}` : "";
    const label = `[${task.status}] Task ${shortId} — "${task.title}" (${tier}${confidence})`;

    if (isRoot) {
      lines.push(label);
    } else {
      const connector = isLast ? "└── " : "├── ";
      lines.push(`${prefix}${connector}${label}`);
    }

    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child === undefined) continue;
      const childIsLast = i === children.length - 1;
      this.formatNode(child, childPrefix, false, lines, childIsLast);
    }
  }
}
