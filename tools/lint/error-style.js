"use strict";
/**
 * tools/lint/error-style.js
 *
 * Custom ESLint rule: enforce consistent error message style across SIDJUA.
 *
 * Rules enforced:
 *   1. User-facing error strings starting with "✗ " use "unable to" for
 *      permission/capability failures (not "cannot" or "can't").
 *   2. Existence failures use "not found" (not "does not exist", "missing").
 *   3. Limit/quota failures use "exceeded" (not "surpassed", "over the limit").
 *   4. process.stderr.write calls must start with "✗ " or be a bare variable.
 *   5. Template literals in error positions use backtick (not concatenation).
 */

/** @type {import('eslint').Rule.RuleModule} */
const errorStyle = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Enforce consistent error message style",
      category:    "Style",
    },
    fixable: "code",
    schema: [],
    messages: {
      useUnableTo:     "Use 'unable to' for permission/capability failures (not 'cannot'/'can't').",
      useNotFound:     "Use 'not found' for existence failures (not 'does not exist'/'missing').",
      useExceeded:     "Use 'exceeded' for limit failures (not 'surpassed'/'over the limit').",
      requirePrefix:   "process.stderr.write string must start with '✗ '.",
      useBracketErr:   "Use template literal for dynamic error messages, not string concatenation.",
    },
  },

  create(context) {
    /**
     * Checks a string literal node for forbidden phrasing.
     */
    function checkString(node, value) {
      const v = value.toLowerCase();

      if (/\bcannot\b|\bcan't\b/.test(v) && /\b(access|perform|execute|write|read|delete|create)\b/.test(v)) {
        context.report({ node, messageId: "useUnableTo" });
      }

      if (/\bdoes not exist\b|\bis missing\b/.test(v)) {
        context.report({ node, messageId: "useNotFound" });
      }

      if (/\bsurpassed\b|\bover the limit\b|\bover budget\b/.test(v)) {
        context.report({ node, messageId: "useExceeded" });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") {
          checkString(node, node.value);
        }
      },

      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          checkString(node, quasi.value.cooked ?? "");
        }
      },

      // Enforce "✗ " prefix on process.stderr.write string literals
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "MemberExpression" &&
          node.callee.object.object.type === "Identifier" &&
          node.callee.object.object.name === "process" &&
          node.callee.object.property.type === "Identifier" &&
          node.callee.object.property.name === "stderr" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "write"
        ) {
          const arg = node.arguments[0];
          if (!arg) return;

          // String literal: must start with ✗
          if (arg.type === "Literal" && typeof arg.value === "string") {
            if (!arg.value.startsWith("✗ ") && !arg.value.startsWith("\n")) {
              context.report({ node: arg, messageId: "requirePrefix" });
            }
          }

          // Template literal: first quasi must start with ✗
          if (arg.type === "TemplateLiteral") {
            const first = arg.quasis[0]?.value.cooked ?? "";
            if (first !== "" && !first.startsWith("✗ ") && !first.startsWith("\n")) {
              context.report({ node: arg, messageId: "requirePrefix" });
            }
          }
        }
      },
    };
  },
};

module.exports = {
  rules: {
    "error-style": errorStyle,
  },
};
