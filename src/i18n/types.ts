// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — i18n: Core Types
 *
 * Locale and translation key types used throughout the i18n module.
 */

/** A locale identifier string, e.g. "en", "de". */
export type Locale = string;

/**
 * A dot-notation translation key matching a key in the locale JSON files.
 * The type is `string` (not a union) to keep the module dep-free and flexible.
 */
export type TranslationKey = string;

/** Named interpolation params passed to `t()`. Values are coerced to string. */
export type InterpolationParams = Record<string, string | number>;
