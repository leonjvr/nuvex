// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Re-export shim — canonical implementation lives in src/core/db/helpers.ts.
 * This module is kept for backward compatibility with existing imports.
 */
export { hasTable } from "../../core/db/helpers.js";
