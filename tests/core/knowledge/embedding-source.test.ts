// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/knowledge/embedding-source.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import { EmbeddingSourceRegistry } from "../../../src/core/knowledge/embedding-source.js";
import { openDatabase }            from "../../../src/utils/db.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-emb-src-test-"));
}

/** Create workspace structure with knowledge_chunks table and sample data. */
function setupWorkspace(workDir: string, chunkCount: number): void {
  const systemDir = join(workDir, ".system");
  mkdirSync(systemDir, { recursive: true });

  const db = openDatabase(join(systemDir, "sidjua.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id            TEXT PRIMARY KEY,
      content       TEXT NOT NULL,
      metadata      TEXT NOT NULL DEFAULT '{}',
      collection_id TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS knowledge_vectors (
      chunk_id      TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      embedding     BLOB NOT NULL
    );
  `);

  for (let i = 0; i < chunkCount; i++) {
    const collection = i % 2 === 0 ? "collection-a" : "collection-b";
    db.prepare<[string, string, string, string]>(
      "INSERT INTO knowledge_chunks (id, content, metadata, collection_id) VALUES (?, ?, ?, ?)",
    ).run(`chunk-${i}`, `Content for chunk ${i}`, JSON.stringify({ index: i }), collection);
  }

  db.close();
}

describe("EmbeddingSourceRegistry", () => {
  let tmp: string;
  let registry: EmbeddingSourceRegistry;

  beforeEach(() => {
    tmp      = makeTempDir();
    registry = new EmbeddingSourceRegistry(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // getTotalDocumentCount
  // --------------------------------------------------------------------------

  it("returns 0 when no database exists", async () => {
    const count = await registry.getTotalDocumentCount();
    expect(count).toBe(0);
  });

  it("returns correct count with populated knowledge_chunks", async () => {
    setupWorkspace(tmp, 15);
    const count = await registry.getTotalDocumentCount();
    expect(count).toBe(15);
  });

  it("returns 0 when knowledge_chunks table does not exist", async () => {
    mkdirSync(join(tmp, ".system"), { recursive: true });
    const db = openDatabase(join(tmp, ".system", "sidjua.db"));
    db.exec("CREATE TABLE IF NOT EXISTS other_table (id TEXT PRIMARY KEY)");
    db.close();
    const count = await registry.getTotalDocumentCount();
    expect(count).toBe(0);
  });

  // --------------------------------------------------------------------------
  // iterateDocuments (AsyncGenerator — streaming)
  // --------------------------------------------------------------------------

  it("iterateDocuments yields all chunks", async () => {
    setupWorkspace(tmp, 5);
    const docs: string[] = [];
    for await (const doc of registry.iterateDocuments()) {
      docs.push(doc.id);
    }
    expect(docs).toHaveLength(5);
    expect(docs).toContain("chunk-0");
    expect(docs).toContain("chunk-4");
  });

  it("iterateDocuments yields correct content and collection", async () => {
    setupWorkspace(tmp, 3);
    const docs = [];
    for await (const doc of registry.iterateDocuments()) {
      docs.push(doc);
    }
    expect(docs[0]!.content).toBe("Content for chunk 0");
    expect(docs[0]!.collection).toMatch(/collection-[ab]/);
  });

  it("iterateDocuments streams without loading all into memory (AsyncGenerator)", async () => {
    setupWorkspace(tmp, 10);
    const gen = registry.iterateDocuments();
    // Can call next() one at a time
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toBeDefined();
  });

  it("iterateDocuments yields nothing when no chunks exist", async () => {
    const docs = [];
    for await (const doc of registry.iterateDocuments()) {
      docs.push(doc);
    }
    expect(docs).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // getUnmigratedDocuments
  // --------------------------------------------------------------------------

  it("getUnmigratedDocuments yields all chunks initially (none migrated)", async () => {
    setupWorkspace(tmp, 5);
    const docs = [];
    for await (const doc of registry.getUnmigratedDocuments("test-migration-id")) {
      docs.push(doc.id);
    }
    expect(docs).toHaveLength(5);
  });

  it("getUnmigratedDocuments excludes already-migrated documents", async () => {
    setupWorkspace(tmp, 5);
    await registry.markMigrated("chunk-0", "test-mig");
    await registry.markMigrated("chunk-2", "test-mig");

    const docs = [];
    for await (const doc of registry.getUnmigratedDocuments("test-mig")) {
      docs.push(doc.id);
    }
    expect(docs).not.toContain("chunk-0");
    expect(docs).not.toContain("chunk-2");
    expect(docs).toHaveLength(3);
  });

  // --------------------------------------------------------------------------
  // markMigrated
  // --------------------------------------------------------------------------

  it("markMigrated persists across registry instances", async () => {
    setupWorkspace(tmp, 3);
    await registry.markMigrated("chunk-0", "mig-1");

    // New registry instance (simulates restart)
    const registry2 = new EmbeddingSourceRegistry(tmp);
    const docs = [];
    for await (const doc of registry2.getUnmigratedDocuments("mig-1")) {
      docs.push(doc.id);
    }
    expect(docs).not.toContain("chunk-0");
  });

  it("markMigrated is idempotent (calling twice does not throw)", async () => {
    setupWorkspace(tmp, 3);
    await registry.markMigrated("chunk-0", "mig-1");
    await expect(registry.markMigrated("chunk-0", "mig-1")).resolves.not.toThrow();
  });

  // --------------------------------------------------------------------------
  // getRequiredCollections
  // --------------------------------------------------------------------------

  it("getRequiredCollections returns distinct collection IDs", async () => {
    setupWorkspace(tmp, 10); // creates collection-a and collection-b
    const collections = await registry.getRequiredCollections();
    expect(collections).toContain("collection-a");
    expect(collections).toContain("collection-b");
    expect(collections.length).toBe(2);
  });

  it("getRequiredCollections returns empty array when no chunks", async () => {
    const collections = await registry.getRequiredCollections();
    expect(collections).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Migration state
  // --------------------------------------------------------------------------

  it("readMigrationState returns null when no state file", () => {
    expect(registry.readMigrationState()).toBeNull();
  });

  it("writeMigrationState / readMigrationState round-trips", () => {
    const state = {
      migration_id: "test-123",
      started_at: new Date().toISOString(),
      status: "in_progress" as const,
      total_documents: 100,
      migrated_documents: 50,
      failed_documents: 0,
      old_model: "text-embedding-3-small",
      new_model: "text-embedding-3-large",
      old_dimensions: 1536,
      new_dimensions: 3072,
    };
    registry.writeMigrationState(state);
    const loaded = registry.readMigrationState();
    expect(loaded).not.toBeNull();
    expect(loaded!.migration_id).toBe("test-123");
    expect(loaded!.migrated_documents).toBe(50);
  });

  it("deleteMigrationState removes state file", () => {
    const state = {
      migration_id: "test-456",
      started_at: new Date().toISOString(),
      status: "in_progress" as const,
      total_documents: 10,
      migrated_documents: 5,
      failed_documents: 0,
      old_model: "m1",
      new_model: "m2",
      old_dimensions: 512,
      new_dimensions: 1024,
    };
    registry.writeMigrationState(state);
    registry.deleteMigrationState();
    expect(registry.readMigrationState()).toBeNull();
  });
});
