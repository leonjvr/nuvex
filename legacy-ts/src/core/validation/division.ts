// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Centralised Division Name Validation
 *
 * Division names:
 *   - Must start with a letter (a-z A-Z).
 *   - May contain alphanumeric characters, underscores, and hyphens.
 *   - Maximum 64 characters total.
 *   - Empty string rejected.
 *
 * Import from this module everywhere a division name is accepted to
 * guarantee consistent validation across routes, CLI commands, and config
 * parsing.
 */

import { SidjuaError } from "../error-codes.js";

/** Canonical regex for valid division names. */
export const DIVISION_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Assert that `name` is a valid division name.
 * Throws SidjuaError INPUT-001 when invalid.
 *
 * @param name  The division name to validate.
 * @returns     The validated name (unchanged), for chaining.
 */
export function validateDivisionName(name: string): string {
  if (!DIVISION_RE.test(name)) {
    throw SidjuaError.from(
      "INPUT-001",
      `Invalid division name: "${name}". Must start with a letter, ` +
      "contain only alphanumeric/underscore/hyphen, and be at most 64 chars.",
    );
  }
  return name;
}
