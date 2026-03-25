// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V0.9.6: Memory WAL (Write-Ahead Log)
 *
 * Provides crash-safe writes for the memory ingestion pipeline.
 * Each chunk write is logged as "pending" before DB write, then
 * "committed" after. On recovery, pending-without-committed entries
 * identify chunks that need re-embedding.
 *
 * WAL file: JSONL (one JSON object per line).
 * Format: { id, op, collection, chunk_id, status, ts }
 */

import {
  appendFile,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";


/** Default WAL size threshold that triggers auto-compaction. */
export const WAL_MAX_BYTES = 50 * 1024 * 1024; // 50 MB


export type WalOp = "chunk_write" | "vector_write";
export type WalStatus = "pending" | "committed";

export interface WalEntry {
  id: string;
  op: WalOp;
  collection: string;
  chunk_id: string;
  status: WalStatus;
  ts: string;
}


/** Returns the canonical WAL file path for a given workDir. */
export function getWalPath(workDir: string): string {
  return join(workDir, ".system", "memory", "wal.jsonl");
}


/**
 * Append-only Write-Ahead Log for memory pipeline writes.
 *
 * Usage pattern:
 *   const walId = await wal.appendPending("chunk_write", collectionId, chunkId);
 *   // ... write chunk + vector to SQLite ...
 *   await wal.markCommitted(walId);
 *
 * On crash recovery: `readPending()` returns entries without a matching
 * committed entry — these chunks need to be re-embedded.
 */
export class MemoryWal {
  constructor(private readonly walPath: string) {}

  /**
   * Appends a pending entry and returns its generated ID.
   * Call this BEFORE the DB write.
   */
  async appendPending(op: WalOp, collection: string, chunk_id: string): Promise<string> {
    const entry: WalEntry = {
      id: randomUUID(),
      op,
      collection,
      chunk_id,
      status: "pending",
      ts: new Date().toISOString(),
    };
    await this._append(entry);
    return entry.id;
  }

  /**
   * Appends a committed marker for the given pending entry ID.
   * Call this AFTER a successful DB write.
   */
  async markCommitted(id: string, op: WalOp = "chunk_write", collection = "", chunk_id = ""): Promise<void> {
    const entry: WalEntry = { id, op, collection, chunk_id, status: "committed", ts: new Date().toISOString() };
    await this._append(entry);
  }

  /**
   * Returns all entries that have status "pending" and no matching
   * "committed" entry with the same ID — i.e., writes that may be incomplete.
   */
  async readPending(): Promise<WalEntry[]> {
    const all = await this._readAll();
    const committedIds = new Set(all.filter((e) => e.status === "committed").map((e) => e.id));
    return all.filter((e) => e.status === "pending" && !committedIds.has(e.id));
  }

  /**
   * Rewrites the WAL file keeping only pending (non-committed) entries.
   * Safe to call at startup to reclaim disk space.
   */
  async compact(): Promise<void> {
    const pending = await this.readPending();
    if (!existsSync(this.walPath)) return;
    if (pending.length === 0) {
      await writeFile(this.walPath, "", "utf8");
      return;
    }
    const content = pending.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(this.walPath, content, "utf8");
  }

  /**
   * Compact the WAL if it exceeds `maxBytes` on disk.
   *
   * Calls `compact()` (which discards committed entries) and logs a warning
   * with before/after sizes. Returns true if pruning occurred, false otherwise.
   */
  async pruneIfOversized(maxBytes = WAL_MAX_BYTES): Promise<boolean> {
    if (!existsSync(this.walPath)) return false;
    const sizeBefore = statSync(this.walPath).size;
    if (sizeBefore < maxBytes) return false;

    await this.compact();

    const sizeAfter = existsSync(this.walPath) ? statSync(this.walPath).size : 0;
    process.stderr.write(
      `[sidjua:wal] Auto-pruned WAL: ${Math.round(sizeBefore / 1024)} KB → ${Math.round(sizeAfter / 1024)} KB ` +
      `(threshold: ${Math.round(maxBytes / 1024 / 1024)} MB)\n`,
    );
    return true;
  }

  /** Deletes the WAL file entirely (e.g. after `memory clear`). */
  async delete(): Promise<void> {
    if (existsSync(this.walPath)) {
      await unlink(this.walPath);
    }
  }

  /** Returns true if there are any pending (non-committed) entries. */
  async hasPending(): Promise<boolean> {
    return (await this.readPending()).length > 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async _append(entry: WalEntry): Promise<void> {
    const dir = dirname(this.walPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await appendFile(this.walPath, JSON.stringify(entry) + "\n", "utf8");
  }

  private async _readAll(): Promise<WalEntry[]> {
    if (!existsSync(this.walPath)) return [];
    const content = await readFile(this.walPath, "utf8");
    const entries: WalEntry[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        entries.push(JSON.parse(trimmed) as WalEntry);
      } catch (e: unknown) { void e; /* cleanup-ignore: skip malformed WAL lines from mid-write crash */ }
    }
    return entries;
  }
}
