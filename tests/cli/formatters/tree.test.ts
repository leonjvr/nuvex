/**
 * Tests for src/cli/formatters/tree.ts
 */

import { describe, it, expect } from "vitest";
import { formatTree } from "../../../src/cli/formatters/tree.js";
import type { TreeNode } from "../../../src/cli/formatters/tree.js";

function leaf(label: string, status: string): TreeNode {
  return { label, status, children: [] };
}

function node(label: string, status: string, children: TreeNode[]): TreeNode {
  return { label, status, children };
}

describe("formatTree — root only", () => {
  it("renders single root node with no children", () => {
    const root = leaf("task-1", "RUNNING");
    const out  = formatTree(root);
    expect(out).toBe("task-1  [RUNNING]");
  });
});

describe("formatTree — single level of children", () => {
  it("renders two children with correct connectors", () => {
    const root = node("root", "RUNNING", [
      leaf("child-1", "DONE"),
      leaf("child-2", "RUNNING"),
    ]);
    const lines = formatTree(root).split("\n");

    expect(lines[0]).toBe("root  [RUNNING]");
    expect(lines[1]).toBe("├─ child-1  [DONE]");
    expect(lines[2]).toBe("└─ child-2  [RUNNING]");
  });

  it("uses └─ for single child", () => {
    const root = node("root", "WAITING", [leaf("only-child", "DONE")]);
    const lines = formatTree(root).split("\n");
    expect(lines[1]).toBe("└─ only-child  [DONE]");
  });

  it("uses ├─ for all but last child, └─ for last", () => {
    const root = node("root", "WAITING", [
      leaf("a", "DONE"),
      leaf("b", "DONE"),
      leaf("c", "RUNNING"),
    ]);
    const lines = formatTree(root).split("\n");
    expect(lines[1]!.startsWith("├─")).toBe(true);
    expect(lines[2]!.startsWith("├─")).toBe(true);
    expect(lines[3]!.startsWith("└─")).toBe(true);
  });
});

describe("formatTree — nested tree", () => {
  it("renders grandchildren with correct continuation prefix", () => {
    const root = node("root", "RUNNING", [
      node("child-1", "RUNNING", [
        leaf("grandchild-1a", "DONE"),
        leaf("grandchild-1b", "DONE"),
      ]),
      leaf("child-2", "DONE"),
    ]);
    const out   = formatTree(root);
    const lines = out.split("\n");

    // Root
    expect(lines[0]).toBe("root  [RUNNING]");
    // child-1 is not last → ├─ with │ continuation
    expect(lines[1]).toBe("├─ child-1  [RUNNING]");
    // grandchildren of non-last child get │  prefix
    expect(lines[2]!.startsWith("│  ├─")).toBe(true);
    expect(lines[3]!.startsWith("│  └─")).toBe(true);
    // child-2 is last → └─
    expect(lines[4]).toBe("└─ child-2  [DONE]");
  });

  it("last child continuation uses spaces not │", () => {
    const root = node("root", "WAITING", [
      leaf("a", "DONE"),
      node("b", "RUNNING", [
        leaf("b1", "RUNNING"),
        leaf("b2", "RUNNING"),
      ]),
    ]);
    const lines = formatTree(root).split("\n");

    // "b" is the last child → "└─ b"
    expect(lines[2]).toBe("└─ b  [RUNNING]");
    // b's children use "   " prefix (3 spaces), not "│  "
    expect(lines[3]!.startsWith("   ├─")).toBe(true);
    expect(lines[4]!.startsWith("   └─")).toBe(true);
  });
});

describe("formatTree — wide tree", () => {
  it("renders 5 children correctly", () => {
    const children = Array.from({ length: 5 }, (_, i) =>
      leaf(`task-${i + 1}`, i % 2 === 0 ? "DONE" : "RUNNING"),
    );
    const root = node("root", "WAITING", children);
    const lines = formatTree(root).split("\n");

    expect(lines).toHaveLength(6); // root + 5 children
    expect(lines[5]!.startsWith("└─")).toBe(true); // last child
  });
});

describe("formatTree — status values", () => {
  it("renders status in square brackets", () => {
    const root = leaf("my-task", "ESCALATED");
    expect(formatTree(root)).toContain("[ESCALATED]");
  });
});
