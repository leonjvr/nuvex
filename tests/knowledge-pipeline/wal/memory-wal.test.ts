/**
 * Unit tests: MemoryWal
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryWal, getWalPath, type WalEntry } from "../../../src/knowledge-pipeline/wal/memory-wal.js";

let tempDir: string;
let walPath: string;
let wal: MemoryWal;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sidjua-wal-test-"));
  walPath = join(tempDir, "wal.jsonl");
  wal = new MemoryWal(walPath);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("getWalPath()", () => {
  it("returns correct path under .system/memory/", () => {
    const p = getWalPath("/home/user/sidjua");
    expect(p).toBe("/home/user/sidjua/.system/memory/wal.jsonl");
  });
});

describe("appendPending()", () => {
  it("creates the WAL file on first write", async () => {
    expect(existsSync(walPath)).toBe(false);
    await wal.appendPending("chunk_write", "goetz-memory", "chunk-abc");
    expect(existsSync(walPath)).toBe(true);
  });

  it("returns a unique ID for each call", async () => {
    const id1 = await wal.appendPending("chunk_write", "col", "c1");
    const id2 = await wal.appendPending("chunk_write", "col", "c2");
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("writes a valid JSONL line", async () => {
    await wal.appendPending("chunk_write", "goetz-memory", "chunk-123");
    const lines = readFileSync(walPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as WalEntry;
    expect(entry.status).toBe("pending");
    expect(entry.op).toBe("chunk_write");
    expect(entry.collection).toBe("goetz-memory");
    expect(entry.chunk_id).toBe("chunk-123");
  });

  it("creates parent directories if they don't exist", async () => {
    const nestedWal = new MemoryWal(join(tempDir, "a", "b", "c", "wal.jsonl"));
    await nestedWal.appendPending("chunk_write", "col", "c1");
    expect(existsSync(join(tempDir, "a", "b", "c", "wal.jsonl"))).toBe(true);
  });
});

describe("markCommitted()", () => {
  it("appends a committed entry with matching ID", async () => {
    const id = await wal.appendPending("chunk_write", "col", "c1");
    await wal.markCommitted(id, "chunk_write", "col", "c1");
    const lines = readFileSync(walPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const committed = JSON.parse(lines[1]!) as WalEntry;
    expect(committed.id).toBe(id);
    expect(committed.status).toBe("committed");
  });
});

describe("readPending()", () => {
  it("returns empty array when no WAL file exists", async () => {
    expect(await wal.readPending()).toEqual([]);
  });

  it("returns pending entries that have no committed counterpart", async () => {
    const id1 = await wal.appendPending("chunk_write", "col", "c1");
    await wal.appendPending("chunk_write", "col", "c2"); // uncommitted
    await wal.markCommitted(id1, "chunk_write", "col", "c1");

    const pending = await wal.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.chunk_id).toBe("c2");
  });

  it("returns empty when all entries are committed", async () => {
    const id1 = await wal.appendPending("chunk_write", "col", "c1");
    const id2 = await wal.appendPending("chunk_write", "col", "c2");
    await wal.markCommitted(id1);
    await wal.markCommitted(id2);
    expect(await wal.readPending()).toEqual([]);
  });

  it("skips malformed lines without throwing", async () => {
    appendFileSync(walPath, "not-json\n", "utf8");
    await wal.appendPending("chunk_write", "col", "c1");
    // Should not throw; malformed line is silently skipped
    await expect(wal.readPending()).resolves.not.toThrow();
  });
});

describe("hasPending()", () => {
  it("returns false when WAL is empty", async () => {
    expect(await wal.hasPending()).toBe(false);
  });

  it("returns true when there are uncommitted entries", async () => {
    await wal.appendPending("chunk_write", "col", "c1");
    expect(await wal.hasPending()).toBe(true);
  });

  it("returns false when all entries are committed", async () => {
    const id = await wal.appendPending("chunk_write", "col", "c1");
    await wal.markCommitted(id);
    expect(await wal.hasPending()).toBe(false);
  });
});

describe("compact()", () => {
  it("is a no-op when WAL file does not exist", async () => {
    await expect(wal.compact()).resolves.not.toThrow();
    expect(existsSync(walPath)).toBe(false);
  });

  it("truncates file to empty when all entries are committed", async () => {
    const id = await wal.appendPending("chunk_write", "col", "c1");
    await wal.markCommitted(id);
    await wal.compact();
    expect(readFileSync(walPath, "utf8")).toBe("");
  });

  it("keeps only pending entries after compact", async () => {
    const id1 = await wal.appendPending("chunk_write", "col", "c1");
    await wal.appendPending("chunk_write", "col", "c2");
    await wal.markCommitted(id1);
    await wal.compact();

    const lines = readFileSync(walPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as WalEntry;
    expect(entry.chunk_id).toBe("c2");
    expect(entry.status).toBe("pending");
  });

  it("readPending() still works correctly after compact", async () => {
    const id1 = await wal.appendPending("chunk_write", "col", "c1");
    await wal.appendPending("chunk_write", "col", "c2");
    await wal.markCommitted(id1);
    await wal.compact();

    const pending = await wal.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.chunk_id).toBe("c2");
  });
});

describe("delete()", () => {
  it("deletes the WAL file", async () => {
    await wal.appendPending("chunk_write", "col", "c1");
    expect(existsSync(walPath)).toBe(true);
    await wal.delete();
    expect(existsSync(walPath)).toBe(false);
  });

  it("is a no-op when WAL file does not exist", async () => {
    await expect(wal.delete()).resolves.not.toThrow();
  });
});

describe("crash recovery scenario", () => {
  it("detects chunk written to WAL but not committed (simulates crash)", async () => {
    // Simulate: pending written, then process crashed before DB write completed
    await wal.appendPending("chunk_write", "goetz-memory", "chunk-crashed");

    // On restart: readPending() should return the un-committed entry
    const fresh = new MemoryWal(walPath);
    const pending = await fresh.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.chunk_id).toBe("chunk-crashed");
    expect(pending[0]!.collection).toBe("goetz-memory");
  });

  it("multiple pending entries from partial batch write", async () => {
    // Simulate 3 pending, 2 committed = 1 remaining pending
    const ids = [
      await wal.appendPending("chunk_write", "col", "c1"),
      await wal.appendPending("chunk_write", "col", "c2"),
      await wal.appendPending("chunk_write", "col", "c3"),
    ];
    await wal.markCommitted(ids[0]!);
    await wal.markCommitted(ids[2]!);

    const pending = await wal.readPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.chunk_id).toBe("c2");
  });
});
