// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10: Tree formatter
 *
 * ASCII tree rendering for task hierarchies using Unicode box-drawing characters.
 *
 * Example output:
 *   task-a  [RUNNING]
 *   ├─ task-a-01  [DONE]
 *   │  ├─ task-a-01a  [DONE]
 *   │  └─ task-a-01b  [DONE]
 *   └─ task-a-02  [RUNNING]
 */


export interface TreeNode {
  label:    string;
  status:   string;
  children: TreeNode[];
}


/**
 * Render a TreeNode hierarchy as an indented ASCII tree string.
 * Uses Unicode box-drawing characters: ├─, └─, │
 */
export function formatTree(root: TreeNode): string {
  const lines: string[] = [];
  renderNode(root, "", true, true, lines);
  return lines.join("\n");
}


/**
 * Recursively render a node and its children.
 *
 * @param node      Current node to render
 * @param prefix    Current indentation prefix (accumulated from ancestors)
 * @param isRoot    True only for the root node
 * @param isLast    True if this node is the last child of its parent
 * @param out       Output lines array (mutated in-place)
 */
function renderNode(
  node:   TreeNode,
  prefix: string,
  isRoot: boolean,
  isLast: boolean,
  out:    string[],
): void {
  const connector = isRoot
    ? ""
    : isLast
      ? "└─ "
      : "├─ ";

  out.push(`${prefix}${connector}${node.label}  [${node.status}]`);

  const childPrefix = isRoot
    ? ""
    : isLast
      ? prefix + "   "
      : prefix + "│  ";

  for (let i = 0; i < node.children.length; i++) {
    const child  = node.children[i]!;
    const isLastChild = i === node.children.length - 1;
    renderNode(child, childPrefix, false, isLastChild, out);
  }
}
