// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { registerSecretRoutes } from "../../src/api/routes/secrets.js";
import type { SecretsProvider, SecretMetadata } from "../../src/types/apply.js";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const META: SecretMetadata = {
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  last_accessed_at: "2026-01-03T00:00:00Z",
  last_accessed_by: "system",
  rotation_age_days: 30,
  version: 2,
};

function makeProvider(): SecretsProvider {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue("test-value"),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(["alpha", "beta"]),
    ensureNamespace: vi.fn().mockResolvedValue(undefined),
    rotate: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue(META),
  };
}

function makeSecretsDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      namespace TEXT NOT NULL,
      key       TEXT NOT NULL,
      value_encrypted TEXT NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (namespace, key)
    );
  `);
  // Insert some test rows
  db.prepare("INSERT INTO secrets (namespace, key, value_encrypted) VALUES (?, ?, ?)").run("global", "k1", "enc");
  db.prepare("INSERT INTO secrets (namespace, key, value_encrypted) VALUES (?, ?, ?)").run("divisions/eng", "k2", "enc");
  return db;
}

function makeApp(provider: SecretsProvider, secretsDb: InstanceType<typeof Database>): Hono {
  const app = new Hono();
  app.use("*", withAdminCtx);
  registerSecretRoutes(app, { provider, secretsDb, callerContext: { role: "operator" } });
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/v1/secrets/namespaces
// ---------------------------------------------------------------------------

describe("GET /api/v1/secrets/namespaces", () => {
  it("returns distinct namespaces from DB", async () => {
    const db  = makeSecretsDb();
    const app = makeApp(makeProvider(), db);

    const res  = await app.request("/api/v1/secrets/namespaces");
    const body = (await res.json()) as { namespaces: string[] };

    expect(res.status).toBe(200);
    expect(body.namespaces).toContain("global");
    expect(body.namespaces).toContain("divisions/eng");
    db.close();
  });

  it("returns empty array when secrets table missing", async () => {
    const db = new Database(":memory:");
    // No secrets table
    const app = makeApp(makeProvider(), db);

    const res  = await app.request("/api/v1/secrets/namespaces");
    const body = (await res.json()) as { namespaces: string[] };

    expect(res.status).toBe(200);
    expect(body.namespaces).toEqual([]);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/secrets/keys?ns=<ns>
// ---------------------------------------------------------------------------

describe("GET /api/v1/secrets/keys", () => {
  it("returns keys for a namespace", async () => {
    const provider = makeProvider();
    const db  = makeSecretsDb();
    const app = makeApp(provider, db);

    const res  = await app.request("/api/v1/secrets/keys?ns=global");
    const body = (await res.json()) as { namespace: string; keys: string[] };

    expect(res.status).toBe(200);
    expect(body.namespace).toBe("global");
    expect(body.keys).toEqual(["alpha", "beta"]);
    expect(provider.list).toHaveBeenCalledWith("global");
    db.close();
  });

  it("returns 400 when ns param missing", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/keys");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/secrets/value?ns=<ns>&key=<key>
// ---------------------------------------------------------------------------

describe("GET /api/v1/secrets/value", () => {
  it("returns value for existing secret", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, makeSecretsDb());

    const res  = await app.request("/api/v1/secrets/value?ns=global&key=MY_KEY");
    const body = (await res.json()) as { value: string; namespace: string; key: string };

    expect(res.status).toBe(200);
    expect(body.value).toBe("test-value");
    expect(body.namespace).toBe("global");
    expect(body.key).toBe("MY_KEY");
    expect(provider.get).toHaveBeenCalledWith("global", "MY_KEY");
  });

  it("returns 404 when secret not found", async () => {
    const provider = makeProvider();
    vi.mocked(provider.get).mockResolvedValue(null);
    const app = makeApp(provider, makeSecretsDb());

    const res = await app.request("/api/v1/secrets/value?ns=global&key=MISSING");
    expect(res.status).toBe(404);
  });

  it("returns 400 when params missing", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/value?ns=global");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/secrets/value
// ---------------------------------------------------------------------------

describe("PUT /api/v1/secrets/value", () => {
  it("sets a secret and returns ok", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, makeSecretsDb());

    const res = await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "NEW_KEY", value: "my-secret" }),
    });
    const body = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(provider.set).toHaveBeenCalledWith("global", "NEW_KEY", "my-secret");
  });

  it("returns 400 for missing fields", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "K" }), // missing value
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/secrets/value?ns=<ns>&key=<key>
// ---------------------------------------------------------------------------

describe("DELETE /api/v1/secrets/value", () => {
  it("deletes a secret and returns ok", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, makeSecretsDb());

    const res  = await app.request("/api/v1/secrets/value?ns=global&key=OLD_KEY", { method: "DELETE" });
    const body = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(provider.delete).toHaveBeenCalledWith("global", "OLD_KEY");
  });

  it("returns 400 when params missing", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/value?ns=global", { method: "DELETE" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/secrets/info?ns=<ns>&key=<key>
// ---------------------------------------------------------------------------

describe("GET /api/v1/secrets/info", () => {
  it("returns metadata for existing secret", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, makeSecretsDb());

    const res  = await app.request("/api/v1/secrets/info?ns=global&key=MY_KEY");
    const body = (await res.json()) as { meta: SecretMetadata };

    expect(res.status).toBe(200);
    expect(body.meta.version).toBe(2);
    expect(provider.getMetadata).toHaveBeenCalledWith("global", "MY_KEY");
  });

  it("returns 404 when secret not found", async () => {
    const provider = makeProvider();
    vi.mocked(provider.getMetadata).mockResolvedValue(null);
    const app = makeApp(provider, makeSecretsDb());

    const res = await app.request("/api/v1/secrets/info?ns=global&key=MISSING");
    expect(res.status).toBe(404);
  });

  it("returns 400 when params missing", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/info?ns=global");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/secrets/rotate
// ---------------------------------------------------------------------------

describe("POST /api/v1/secrets/rotate", () => {
  it("rotates a secret and returns ok+rotated", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, makeSecretsDb());

    const res = await app.request("/api/v1/secrets/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "API_KEY", value: "new-secret" }),
    });
    const body = (await res.json()) as { ok: boolean; rotated: boolean };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rotated).toBe(true);
    expect(provider.rotate).toHaveBeenCalledWith("global", "API_KEY", "new-secret");
  });

  it("returns 400 for missing fields", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "K" }), // missing value
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON", async () => {
    const app = makeApp(makeProvider(), makeSecretsDb());
    const res = await app.request("/api/v1/secrets/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad json",
    });
    expect(res.status).toBe(400);
  });
});
