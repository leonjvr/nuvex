// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Shared HTTP body size limit for all request-body middlewares.
 *
 * Both body-limit.ts and input-sanitizer.ts must enforce the same ceiling
 * so that requests do not slip through one check and fail unexpectedly at
 * the other. Having two different defaults caused requests between 1-2 MB
 * to pass body-limit but be rejected by input-sanitizer with a confusing error.
 *
 * Override via SIDJUA_MAX_BODY_BYTES environment variable (bytes).
 * Default: 1 MiB.
 */

/** Maximum allowed request body size in bytes. */
export const MAX_BODY_BYTES: number = (() => {
  const env = process.env["SIDJUA_MAX_BODY_BYTES"] ?? process.env["SIDJUA_MAX_BODY_SIZE"];
  if (env !== undefined) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 1 * 1024 * 1024; // 1 MiB
})();
