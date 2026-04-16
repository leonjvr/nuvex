// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — i18n: Public API (P190)
 *
 * Flat JSON locale files in src/locales/<locale>.json.
 * Zero external dependencies. Graceful fallback — never crashes.
 *
 * Usage:
 *   import { t, msg, setLocale, getLocale } from "../i18n/index.js";
 *
 *   t("cli.start.already_running", { pid: 1234 })
 *   msg("memory.search.no_results", { query: "test" })  // alias, backward compat
 */

export { t, t as msg }     from "./translator.js";
export {
  getLocale,
  setLocale,
  getAvailableLocales,
  loadLocaleData,
  getCurrentLocaleData,
  clearLocaleCache,
  initLocaleFromDb,
  getLocaleInfo,
  getAllLocaleInfo,
} from "./loader.js";
export type { Locale, TranslationKey, InterpolationParams } from "./types.js";
export type { LocaleInfo } from "./loader.js";


import { loadLocaleData as _loadEn } from "./loader.js";

/** Flat English locale data for use in test assertions. */
export const rawMessages: Record<string, string> = _loadEn("en");
