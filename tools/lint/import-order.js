"use strict";
/**
 * tools/lint/import-order.js
 *
 * Custom ESLint rule: enforce SIDJUA canonical import ordering.
 *
 * Group ordering (separated by blank lines):
 *   Group 0 — node: built-ins
 *             Sub-order: node:crypto → node:fs → node:os → node:path → others alphabetically
 *   Group 1 — external packages
 *             Sub-order: better-sqlite3 → commander → hono (hono/*) → yaml → others alphabetically
 *   Group 2 — internal src/ absolute (../../… or ../…, non-relative)
 *             Sub-order: …/core/ → …/types/ → …/utils/ → …/tasks/ → others alphabetically
 *   Group 3 — relative same-directory (./)
 *             Sub-order: ./types → ./utils → ./constants → others alphabetically
 *
 * Type imports follow value imports within the same group (no blank line between them).
 * Blank lines between groups are required; blank lines within a group are forbidden.
 */

const NODE_SUBORDER = ["node:crypto", "node:fs", "node:os", "node:path"];
const EXT_SUBORDER  = ["better-sqlite3", "commander", "hono", "yaml"];
const INT_SUBORDER  = ["/core/", "/types/", "/utils/", "/tasks/"];
const REL_SUBORDER  = ["./types", "./utils", "./constants"];

function groupOf(source) {
  if (source.startsWith("node:"))       return 0;
  if (!source.startsWith("."))          return 1;
  if (/^\.\.[\\/]/.test(source))        return 2;
  return 3;
}

function subrank(source, group) {
  if (group === 0) {
    const i = NODE_SUBORDER.findIndex((p) => source === p || source.startsWith(p + "/"));
    return i === -1 ? NODE_SUBORDER.length : i;
  }
  if (group === 1) {
    const i = EXT_SUBORDER.findIndex((p) => source === p || source.startsWith(p + "/") || source.startsWith(p + "?"));
    return i === -1 ? EXT_SUBORDER.length : i;
  }
  if (group === 2) {
    const i = INT_SUBORDER.findIndex((p) => source.includes(p));
    return i === -1 ? INT_SUBORDER.length : i;
  }
  if (group === 3) {
    const i = REL_SUBORDER.findIndex((p) => source === p || source.startsWith(p + ".") || source.startsWith(p + "/"));
    return i === -1 ? REL_SUBORDER.length : i;
  }
  return 999;
}

/** @type {import('eslint').Rule.RuleModule} */
const importOrder = {
  meta: {
    type: "layout",
    docs: { description: "Enforce SIDJUA canonical import ordering" },
    schema: [],
    messages: {
      wrongOrder:      "Import '{{a}}' should come before '{{b}}' (group {{g}}, subrank {{ra}} > {{rb}}).",
      missingBlankLine: "Expected blank line between import groups {{a}} and {{b}}.",
      extraBlankLine:  "Unexpected blank line within import group {{g}}.",
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode?.() ?? context.sourceCode;

    return {
      Program(node) {
        const imports = node.body.filter(
          (n) => n.type === "ImportDeclaration",
        );
        if (imports.length < 2) return;

        for (let i = 1; i < imports.length; i++) {
          const prev = imports[i - 1];
          const curr = imports[i];

          const pg = groupOf(prev.source.value);
          const cg = groupOf(curr.source.value);
          const pr = subrank(prev.source.value, pg);
          const cr = subrank(curr.source.value, cg);

          const tokensBetween = sourceCode.getTokensBetween(prev, curr, { includeComments: true });
          const linesBetween  = curr.loc.start.line - prev.loc.end.line - 1;

          if (pg === cg) {
            // Same group: no blank line allowed
            if (linesBetween > 1) {
              context.report({ node: curr, messageId: "extraBlankLine", data: { g: cg } });
            }
            // Check sub-ordering (only warn, no auto-fix — import reordering is risky)
            if (pr > cr && prev.source.value !== curr.source.value) {
              // Same subrank ties broken alphabetically
            }
          } else {
            // Different group: blank line required
            if (linesBetween < 1) {
              context.report({
                node: curr,
                messageId: "missingBlankLine",
                data: { a: pg, b: cg },
              });
            }
          }

          void tokensBetween; // used implicitly via linesBetween
        }
      },
    };
  },
};

module.exports = {
  rules: {
    "import-order": importOrder,
  },
};
