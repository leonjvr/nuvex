/**
 * Integration test: Environment CRUD
 *
 * Covers: create / read / update-status / testConnectivity (local) / delete
 * lifecycle against a real in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runToolMigrations } from "../../../src/tool-integration/migration.js";
import { EnvironmentManager } from "../../../src/tool-integration/environment-manager.js";

let db: ReturnType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  runToolMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("Environment CRUD Integration", () => {
  it("create/read/update/delete environment; local connectivity test passes", async () => {
    // 1. Create EnvironmentManager
    const manager = new EnvironmentManager(db);

    // 2. Create a local environment
    const created = manager.create({
      id: "env-test",
      name: "Test Env",
      type: "local",
      config: {
        id: "env-test",
        name: "Test Env",
        type: "local",
        connection: { type: "local" },
      },
    });

    expect(created.id).toBe("env-test");
    expect(created.name).toBe("Test Env");
    expect(created.type).toBe("local");

    // 3. Read back by ID and verify fields
    const fetched = manager.getById("env-test");
    expect(fetched.id).toBe("env-test");
    expect(fetched.name).toBe("Test Env");
    expect(fetched.type).toBe("local");
    // Freshly created environments default to 'unknown' status
    expect(fetched.status).toBe("unknown");

    // 4. Update status to 'active' and verify
    manager.updateStatus("env-test", "active");
    const afterUpdate = manager.getById("env-test");
    expect(afterUpdate.status).toBe("active");

    // 5. Test local connectivity — must return connected=true
    const connectivity = await manager.testConnectivity("env-test");
    expect(connectivity.connected).toBe(true);

    // After a successful connectivity test the DB status is updated to 'active'
    const afterTest = manager.getById("env-test");
    expect(afterTest.status).toBe("active");
    expect(afterTest.last_tested_at).toBeDefined();

    // 6. Delete the environment and verify list() is empty
    manager.delete("env-test");
    const remaining = manager.list();
    expect(remaining).toHaveLength(0);
  });
});
