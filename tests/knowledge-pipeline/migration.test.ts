/**
 * Unit tests: Knowledge Pipeline Migrations
 */

import { describe, it, expect } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runKnowledgeMigrations } from "../../src/knowledge-pipeline/migration.js";

function makeDb(): Database {
  return new BetterSQLite3(":memory:");
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return row !== undefined;
}

function virtualTableExists(db: Database, name: string): boolean {
  // FTS5 virtual tables show up with type='table' in sqlite_master
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE name=?")
    .get(name);
  return row !== undefined;
}

function getColumns(db: Database, tableName: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe("runKnowledgeMigrations", () => {
  it("creates all expected tables", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    expect(tableExists(db, "knowledge_collections")).toBe(true);
    expect(tableExists(db, "knowledge_chunks")).toBe(true);
    expect(tableExists(db, "knowledge_vectors")).toBe(true);
    expect(tableExists(db, "knowledge_access_log")).toBe(true);
    expect(tableExists(db, "policy_rules")).toBe(true);
    expect(virtualTableExists(db, "knowledge_chunks_fts")).toBe(true);

    db.close();
  });

  it("running migrations twice is idempotent (no error)", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);
    // Should not throw
    expect(() => runKnowledgeMigrations(db)).not.toThrow();
    db.close();
  });

  it("knowledge_collections table has correct columns", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    const columns = getColumns(db, "knowledge_collections");
    expect(columns).toContain("id");
    expect(columns).toContain("name");
    expect(columns).toContain("description");
    expect(columns).toContain("scope_json");
    expect(columns).toContain("classification");
    expect(columns).toContain("config_yaml");
    expect(columns).toContain("chunk_count");
    expect(columns).toContain("total_tokens");
    expect(columns).toContain("status");
    expect(columns).toContain("created_at");
    expect(columns).toContain("updated_at");

    db.close();
  });

  it("knowledge_chunks_fts virtual table exists and is queryable", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    // Verify the virtual table exists by querying it
    expect(() => {
      db.prepare("SELECT * FROM knowledge_chunks_fts LIMIT 1").all();
    }).not.toThrow();

    db.close();
  });

  it("policy_rules table exists with correct columns", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    expect(tableExists(db, "policy_rules")).toBe(true);

    const columns = getColumns(db, "policy_rules");
    expect(columns).toContain("id");
    expect(columns).toContain("source_file");
    expect(columns).toContain("rule_type");
    expect(columns).toContain("action_pattern");
    expect(columns).toContain("condition");
    expect(columns).toContain("enforcement");
    expect(columns).toContain("escalate_to");
    expect(columns).toContain("reason");
    expect(columns).toContain("active");
    expect(columns).toContain("created_at");

    db.close();
  });

  it("knowledge_chunks table has correct columns", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    const columns = getColumns(db, "knowledge_chunks");
    expect(columns).toContain("id");
    expect(columns).toContain("collection_id");
    expect(columns).toContain("source_file");
    expect(columns).toContain("content");
    expect(columns).toContain("token_count");
    expect(columns).toContain("position");
    expect(columns).toContain("section_path");
    expect(columns).toContain("page_number");
    expect(columns).toContain("preceding_context");
    expect(columns).toContain("metadata");
    expect(columns).toContain("created_at");

    db.close();
  });

  it("knowledge_vectors table has correct columns", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    const columns = getColumns(db, "knowledge_vectors");
    expect(columns).toContain("chunk_id");
    expect(columns).toContain("collection_id");
    expect(columns).toContain("embedding");

    db.close();
  });

  it("migration tracking table _migrations is created and records the version", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    expect(tableExists(db, "_migrations")).toBe(true);
    const row = db.prepare("SELECT version FROM _migrations WHERE version = ?").get("1.7") as
      | { version: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.version).toBe("1.7");

    db.close();
  });

  it("knowledge_access_log table has correct columns", () => {
    const db = makeDb();
    runKnowledgeMigrations(db);

    const columns = getColumns(db, "knowledge_access_log");
    expect(columns).toContain("id");
    expect(columns).toContain("agent_id");
    expect(columns).toContain("collection_id");
    expect(columns).toContain("query");
    expect(columns).toContain("chunks_returned");
    expect(columns).toContain("top_score");
    expect(columns).toContain("cost_usd");
    expect(columns).toContain("timestamp");

    db.close();
  });
});
