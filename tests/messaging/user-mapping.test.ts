/**
 * V1.1 — UserMappingStore unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import { UserMappingStore } from "../../src/messaging/user-mapping.js";
import type { Database } from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database {
  return new BetterSQLite3(":memory:") as unknown as Database;
}

function makeStore(): { store: UserMappingStore; db: Database } {
  const db    = makeDb();
  const store = new UserMappingStore(db);
  return { store, db };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UserMappingStore — initialize()", () => {
  it("creates the table without error", async () => {
    const { store, db } = makeStore();
    await store.initialize();
    const row = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messaging_user_mappings'",
    ).get();
    expect(row?.name).toBe("messaging_user_mappings");
  });

  it("is idempotent (can be called twice)", async () => {
    const { store } = makeStore();
    await expect(store.initialize()).resolves.toBeUndefined();
    await expect(store.initialize()).resolves.toBeUndefined();
  });
});

describe("UserMappingStore — mapUser / lookupUser", () => {
  let store: UserMappingStore;

  beforeEach(async () => {
    ({ store } = makeStore());
    await store.initialize();
  });

  it("maps a user and lookupUser returns the mapping", async () => {
    await store.mapUser("sidjua-1", "tg-instance", "tg-123");
    const m = store.lookupUser("tg-instance", "tg-123");
    expect(m).not.toBeNull();
    expect(m!.sidjua_user_id).toBe("sidjua-1");
    expect(m!.instance_id).toBe("tg-instance");
    expect(m!.platform_user_id).toBe("tg-123");
    expect(m!.role).toBe("user");
  });

  it("lookupUser returns null for unknown mapping", () => {
    const m = store.lookupUser("tg-instance", "unknown");
    expect(m).toBeNull();
  });

  it("maps user with explicit role", async () => {
    await store.mapUser("sidjua-1", "tg-instance", "tg-999", "admin");
    const m = store.lookupUser("tg-instance", "tg-999");
    expect(m!.role).toBe("admin");
  });

  it("upserts on re-map (same instance + platform_user_id)", async () => {
    await store.mapUser("sidjua-1", "tg-instance", "tg-123");
    await store.mapUser("sidjua-2", "tg-instance", "tg-123", "admin"); // re-map
    const m = store.lookupUser("tg-instance", "tg-123");
    expect(m!.sidjua_user_id).toBe("sidjua-2");
    expect(m!.role).toBe("admin");
  });

  it("same platform_user_id on different instances = different mappings", async () => {
    await store.mapUser("sidjua-1", "tg-alpha", "user-42");
    await store.mapUser("sidjua-2", "tg-beta",  "user-42"); // same platform ID, different instance
    const a = store.lookupUser("tg-alpha", "user-42");
    const b = store.lookupUser("tg-beta",  "user-42");
    expect(a!.sidjua_user_id).toBe("sidjua-1");
    expect(b!.sidjua_user_id).toBe("sidjua-2");
  });
});

describe("UserMappingStore — unmapUser", () => {
  let store: UserMappingStore;

  beforeEach(async () => {
    ({ store } = makeStore());
    await store.initialize();
  });

  it("removes an existing mapping", async () => {
    await store.mapUser("sidjua-1", "tg-instance", "tg-123");
    await store.unmapUser("tg-instance", "tg-123");
    expect(store.lookupUser("tg-instance", "tg-123")).toBeNull();
  });

  it("no-op when mapping does not exist", async () => {
    await expect(store.unmapUser("tg-instance", "nonexistent")).resolves.toBeUndefined();
  });
});

describe("UserMappingStore — isAuthorized", () => {
  let store: UserMappingStore;

  beforeEach(async () => {
    ({ store } = makeStore());
    await store.initialize();
  });

  it("returns true for mapped user", async () => {
    await store.mapUser("sidjua-1", "inst-1", "user-1");
    expect(store.isAuthorized("inst-1", "user-1")).toBe(true);
  });

  it("returns false for unmapped user", () => {
    expect(store.isAuthorized("inst-1", "unknown")).toBe(false);
  });

  it("checks per instance — mapped on alpha, not on beta", async () => {
    await store.mapUser("sidjua-1", "inst-alpha", "user-1");
    expect(store.isAuthorized("inst-alpha", "user-1")).toBe(true);
    expect(store.isAuthorized("inst-beta",  "user-1")).toBe(false);
  });
});

describe("UserMappingStore — listMappings", () => {
  let store: UserMappingStore;

  beforeEach(async () => {
    ({ store } = makeStore());
    await store.initialize();
    await store.mapUser("user-A", "inst-1", "p-1");
    await store.mapUser("user-B", "inst-1", "p-2");
    await store.mapUser("user-A", "inst-2", "p-3");
  });

  it("returns all mappings when no filter", () => {
    expect(store.listMappings()).toHaveLength(3);
  });

  it("filters by sidjua_user_id", () => {
    const result = store.listMappings("user-A");
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.sidjua_user_id === "user-A")).toBe(true);
  });

  it("returns empty array when filter matches nobody", () => {
    expect(store.listMappings("nonexistent")).toHaveLength(0);
  });
});
