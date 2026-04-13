// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — i18n: Translation Function
 *
 * `t(key, params?)` — look up a translation key in the active locale and
 * interpolate `{paramName}` placeholders.
 *
 * Design rules:
 *   - NEVER throw or crash — missing key returns the key itself
 *   - Interpolation uses `{paramName}` syntax (no double braces)
 *   - Unknown placeholders are left as `{paramName}` in the output
 */

import { getCurrentLocaleData } from "./loader.js";
import type { TranslationKey, InterpolationParams } from "./types.js";

/**
 * Translate a key using the currently active locale.
 *
 * @param key    Dot-notation translation key, e.g. `"cli.start.already_running"`
 * @param params Named interpolation values, e.g. `{ pid: 1234 }`
 * @returns      Translated + interpolated string, or `key` if not found
 *
 * @example
 * t("cli.start.already_running", { pid: 1234 })
 * // → "✗ Orchestrator already running (PID 1234)."
 */
export function t(key: TranslationKey, params?: InterpolationParams): string {
  const data  = getCurrentLocaleData();
  let   value = data[key];

  // Graceful fallback: return key itself if not found — never crash
  if (value === undefined) return key;

  // Interpolate {paramName} placeholders
  if (params !== undefined) {
    value = value.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const v = params[name];
      return v !== undefined ? String(v) : `{${name}}`;
    });
  }

  return value;
}
