// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Interactive prompt utilities using Node.js built-in readline/promises.
 * No external dependencies. Designed for Node.js 22+.
 *
 * All prompts are skipped when stdin is not a TTY or when `force` is true,
 * returning the provided default value immediately.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";


/**
 * Prompt for a free-text answer.
 * Returns `defaultValue` if stdin is not a TTY or the user presses Enter.
 */
export async function askText(
  question:     string,
  defaultValue: string = "",
): Promise<string> {
  if (!stdin.isTTY) return defaultValue;

  const rl     = createInterface({ input: stdin, output: stdout, terminal: true });
  const suffix = defaultValue ? ` (default: ${defaultValue})` : "";
  let answer: string;
  try {
    answer = await rl.question(`  ${question}${suffix}: `);
  } finally {
    rl.close();
  }
  return answer.trim() || defaultValue;
}


export interface ChoiceOption {
  key:   string;
  label: string;
}

/**
 * Present a labeled list of choices and wait for the user to pick one.
 * Returns `defaultKey` if stdin is not a TTY or the user presses Enter.
 * Falls back to `options[0].key` if no default is provided.
 */
export async function askChoice(
  prompt:     string,
  options:    ChoiceOption[],
  defaultKey?: string,
): Promise<string> {
  const fallback = defaultKey ?? options[0]?.key ?? "";

  if (!stdin.isTTY) return fallback;

  stdout.write(`\n  ${prompt}\n`);
  for (const opt of options) {
    stdout.write(`    (${opt.key}) ${opt.label}\n`);
  }

  const keys   = options.map((o) => o.key).join("/");
  const suffix = fallback ? ` (default: ${fallback})` : "";

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  let answer: string;
  try {
    answer = await rl.question(`\n  Your choice [${keys}]${suffix}: `);
  } finally {
    rl.close();
  }

  const choice = answer.trim().toLowerCase() || fallback;
  return options.some((o) => o.key === choice) ? choice : fallback;
}


/**
 * Prompt for an API key or secret value with masked input (no echo).
 * Uses raw mode on TTY to suppress character echo; falls back to visible input on non-TTY.
 */
export async function askSecret(question: string): Promise<string> {
  if (!stdin.isTTY) return "";

  return new Promise<string>((resolve) => {
    stderr.write(`  ${question}: `);

    // Enable raw mode to suppress echo
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let input = "";

    const onData = (char: string) => {
      if (char === "\n" || char === "\r") {
        // Enter — finish input
        stderr.write("\n");
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        resolve(input.trim());
      } else if (char === "\u007f" || char === "\b") {
        // Backspace
        input = input.slice(0, -1);
      } else if (char === "\u0003") {
        // Ctrl+C
        stderr.write("\n");
        stdin.setRawMode(false);
        process.exit(1);
      } else {
        input += char;
      }
    };

    stdin.on("data", onData);
  });
}
