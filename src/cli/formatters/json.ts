// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10: JSON formatter
 *
 * Structured JSON output for scripting/piping.
 * Pretty-prints with 2-space indent.
 */

/** Maximum serialised output size in bytes before truncation. */
const MAX_JSON_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Build a JSON.stringify replacer that detects circular references via a WeakSet.
 * Circular values are replaced with the string "[Circular]".
 */
function makeCircularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (value !== null && typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

/**
 * Serialize data to a pretty-printed JSON string.
 * Handles circular references (replaced with "[Circular]") and truncates
 * output larger than 10 MiB to prevent runaway CLI output.
 *
 * Used when --json flag is present on any command.
 */
export function formatJson(data: unknown): string {
  let result: string;
  try {
    result = JSON.stringify(data, makeCircularReplacer(), 2);
  } catch (_e: unknown) {
    // Fallback for non-serialisable values (e.g. BigInt)
    result = JSON.stringify({ error: "Data not serialisable as JSON" }, null, 2);
  }

  if (Buffer.byteLength(result, "utf8") > MAX_JSON_BYTES) {
    process.stderr.write(
      `[json] Output truncated: serialised size exceeds ${MAX_JSON_BYTES / (1024 * 1024)} MiB limit.\n`,
    );
    // Produce a valid JSON wrapper — never slice the serialised string mid-stream
    // as that yields unparseable output. The partial field holds an approximate
    // prefix of the original JSON (character-sliced, not byte-sliced, which is
    // safe because JSON.stringify escapes all non-ASCII characters).
    result = JSON.stringify(
      {
        truncated: true,
        note:      `Output exceeds ${MAX_JSON_BYTES / (1024 * 1024)} MiB limit`,
        partial:   result.slice(0, MAX_JSON_BYTES),
      },
      null,
      2,
    );
  }

  return result;
}
