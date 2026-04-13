// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Knowledge Pipeline: Embedding Dimension Compatibility Check
 *
 * Guards against inserting vectors of a different dimension into a collection
 * that already has vectors from a previous embedding run. A dimension mismatch
 * silently corrupts cosine-similarity results because SQLite stores raw bytes
 * and has no schema-level type enforcement for vector length.
 *
 * Usage:
 *   checkDimensionCompatibility(db, collectionId, embedder.dimensions);
 *   // Throws SYS-010 if the collection already has vectors of a different size.
 */

import type { Database } from "../utils/db.js";
import { SidjuaError } from "../core/error-codes.js";

/**
 * Check that the new embedding dimension matches existing vectors for a collection.
 *
 * Queries the `knowledge_vectors` table for any existing vector in the given
 * collection, derives its dimension from the BLOB byte length (each float32 = 4
 * bytes), and compares against `newDimension`.
 *
 * @param db            - Open SQLite database handle.
 * @param collectionId  - Knowledge collection ID to check.
 * @param newDimension  - Dimension produced by the current embedder.
 *
 * @throws {SidjuaError} SYS-010 if the collection has existing vectors whose
 *   dimension differs from `newDimension`.
 */
export function checkDimensionCompatibility(
  db: Database,
  collectionId: string,
  newDimension: number,
): void {
  if (newDimension <= 0) return; // BM25-only mode — no vector dimension to check

  const row = db
    .prepare<[string], { dim: number }>(
      "SELECT CAST(length(embedding) / 4 AS INTEGER) AS dim FROM knowledge_vectors WHERE collection_id = ? LIMIT 1",
    )
    .get(collectionId);

  if (row === undefined) return; // No existing vectors — new collection or fresh re-embed

  if (row.dim !== newDimension) {
    throw SidjuaError.from(
      "SYS-010",
      `Embedding dimension mismatch for collection "${collectionId}": ` +
        `existing vectors are ${row.dim}d, new embedder produces ${newDimension}d. ` +
        `Run: sidjua memory re-embed  to rebuild all vectors with the new provider.`,
    );
  }
}
