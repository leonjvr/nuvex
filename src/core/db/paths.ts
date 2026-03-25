// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import { join } from "node:path";

/**
 * Canonical database path for any given work directory.
 * Single source of truth — used by update, rollback, start, health, db-init.
 */
export function getCanonicalDbPath(workDir: string): string {
  return join(workDir, ".system", "sidjua.db");
}
