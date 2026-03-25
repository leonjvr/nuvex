// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.
//
// WAL checkpoint worker — spawned by backup.ts checkpointDatabase().
// Runs as a CommonJS worker_threads file — loaded by file path, not inline code.

"use strict";

const { workerData } = require("worker_threads");
const BetterSQLite3  = require("better-sqlite3");

const db = new BetterSQLite3(workerData.dbPath, { readonly: false });
try {
  db.pragma("wal_checkpoint(TRUNCATE)");
} finally {
  db.close();
}
