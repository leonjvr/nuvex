// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for #519 B8, B9, H11:
 *
 *   B8: SSE ticket consumeTicket — delete-first prevents replay attack
 *   B9: Budget check + cost recording — atomicCheckAndReserve uses BEGIN IMMEDIATE
 *  H11: DB schema init — exclusive transaction + busy_timeout
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync }             from "node:fs";
import { join }                                          from "node:path";
import { tmpdir }                                        from "node:os";
import { withAdminCtx }                                  from "../helpers/with-admin-ctx.js";
import Database                                          from "better-sqlite3";
import { openDatabase, runMigrations }                   from "../../src/utils/db.js";
import { MIGRATIONS }                                    from "../../src/apply/database.js";
import { CostTracker }                                   from "../../src/provider/cost-tracker.js";
import type { Database as DbType }                       from "../../src/utils/db.js";
import type { TokenUsage }                               from "../../src/types/provider.js";

// ===========================================================================
// B8: SSE ticket — delete-first (consume-once) semantics
// ===========================================================================

import {
  consumeTicket,
  clearTickets,
  ticketCount,
  stopPruneTimer,
} from "../../src/api/routes/sse-ticket.js";

describe("B8 #519: consumeTicket — atomic delete-first replay prevention", () => {
  beforeEach(() => {
    stopPruneTimer(); // prevent timer interference in tests
    clearTickets();
  });

  afterEach(() => {
    clearTickets();
  });

  function issueTicket(ttlMs = 30_000): string {
    // White-box: we access the internal Map via the module's own state.
    // Easier than going through HTTP. We re-use the module's exported helpers.
    // Actually we need to issue via the internal _tickets Map — but it's private.
    // Workaround: go through the HTTP route helper indirectly using the module's
    // exported issueTicket if it exists, or replicate the logic here.
    //
    // The module doesn't export an issueTicket() helper, so we reach through the
    // implementation by calling the internal pruneExpired path indirectly.
    // The simplest approach: directly manipulate the Map by making it available
    // through a test-only export, or use the Hono handler. Since neither exists,
    // we import the Map reference via a side-channel approach:
    // Just call consumeTicket with a fake UUID — if it returns false the ticket
    // wasn't there, which is what we expect for non-existent tickets.
    //
    // For issuing real tickets we'll call the internal _tickets via a module-
    // level helper. Since _tickets is not exported, we test through the public
    // API: issue via a minimal Hono setup, consume via consumeTicket().
    void ttlMs; // unused — tickets always have TICKET_TTL_MS (30s)

    // Register a ticket by invoking the route handler directly using Hono test support
    // is heavy. Instead, use the module-level state by importing from a test shim.
    // The cleanest path: the module already exports clearTickets()/ticketCount(),
    // meaning internal state IS accessible. We need an issueTicket() helper.
    // Rather than modifying the production module, we drive through the Hono app.
    // BUT: registering a whole Hono app is expensive here. Instead, we call the
    // private mutation by reading the source and calling the prepared-statement path.
    //
    // Pragmatic solution: use the Hono app factory just for ticket issuance.
    // This is acceptable because the security property under test is consumeTicket().
    throw new Error("Use issueViaMap instead");
  }

  // Directly manipulate the ticket store via the module's exported helpers
  // by importing the module-internal map reference via a re-export shim.
  // Since we cannot do that without modifying production code, we drive
  // the ticket issuance through a minimal Hono app.

  // Actually — the simplest, most direct path: just import the internal Map.
  // The module doesn't export _tickets. We'll use dynamic import to get it.
  // However, this is too fragile. Instead:
  //
  // SOLUTION: We test consumeTicket() properties directly by manually calling
  // the registered route, OR by importing the module's named export `_tickets`
  // if we add a test-only export. The correct approach for this test file is
  // to test the *semantic contract* of consumeTicket() without needing to call
  // the issue path. We'll populate the store via the HTTP handler.

  it("returns false for a non-existent ticket", () => {
    expect(consumeTicket("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("returns false for an already-consumed ticket (replay blocked)", async () => {
    // Issue a real ticket via the HTTP handler
    const { Hono }                      = await import("hono");
    const { registerSseTicketRoutes }   = await import("../../src/api/routes/sse-ticket.js");

    const app = new Hono();
    app.use("*", withAdminCtx);
    registerSseTicketRoutes(app, { getApiKey: () => "test-key" });

    const res = await app.request("/api/v1/sse/ticket", {
      method:  "POST",
      headers: { Authorization: "Bearer test-key" },
    });
    expect(res.status).toBe(200);
    const { ticket } = await res.json() as { ticket: string };

    // First consumption: valid
    expect(consumeTicket(ticket)).not.toBe(false);
    // Second consumption: replay blocked
    expect(consumeTicket(ticket)).toBe(false);
  });

  it("ticket is removed from store after consumption", async () => {
    const { Hono }                    = await import("hono");
    const { registerSseTicketRoutes } = await import("../../src/api/routes/sse-ticket.js");

    const app = new Hono();
    app.use("*", withAdminCtx);
    registerSseTicketRoutes(app, { getApiKey: () => "test-key" });

    const res = await app.request("/api/v1/sse/ticket", {
      method:  "POST",
      headers: { Authorization: "Bearer test-key" },
    });
    const { ticket } = await res.json() as { ticket: string };
    const beforeCount = ticketCount();

    consumeTicket(ticket);
    expect(ticketCount()).toBe(beforeCount - 1);
  });

  it("concurrent consumeTicket calls on same ticket: exactly one succeeds", async () => {
    const { Hono }                    = await import("hono");
    const { registerSseTicketRoutes } = await import("../../src/api/routes/sse-ticket.js");

    const app = new Hono();
    app.use("*", withAdminCtx);
    registerSseTicketRoutes(app, { getApiKey: () => "test-key" });

    const res = await app.request("/api/v1/sse/ticket", {
      method:  "POST",
      headers: { Authorization: "Bearer test-key" },
    });
    const { ticket } = await res.json() as { ticket: string };

    // Run multiple consumptions concurrently (JS event loop — not truly parallel,
    // but this validates the delete-first ordering contract even in single-thread)
    const results = await Promise.all([
      Promise.resolve(consumeTicket(ticket)),
      Promise.resolve(consumeTicket(ticket)),
      Promise.resolve(consumeTicket(ticket)),
    ]);

    const trueCount = results.filter(Boolean).length;
    expect(trueCount).toBe(1); // exactly one succeeds
  });

  it("sse-ticket.ts source uses delete-first pattern (B8 structural check)", () => {
    const src = readFileSync(
      new URL("../../src/api/routes/sse-ticket.ts", import.meta.url),
      "utf-8",
    );
    // delete must appear before the expiry check in consumeTicket
    const consumeFnStart = src.indexOf("export function consumeTicket");
    const deleteIdx      = src.indexOf("_tickets.delete(ticket)", consumeFnStart);
    const expiryIdx      = src.indexOf("entry.expiresAt", consumeFnStart);
    expect(deleteIdx).toBeGreaterThan(0);
    expect(expiryIdx).toBeGreaterThan(0);
    // delete must come BEFORE the expiry check
    expect(deleteIdx).toBeLessThan(expiryIdx);
  });
});

// ===========================================================================
// B9: Budget — atomicCheckAndReserve uses BEGIN IMMEDIATE
// ===========================================================================

describe("B9 #519: CostTracker.atomicCheckAndReserve — atomic check + reservation", () => {
  let tmpDir: string;
  let db: DbType;
  let tracker: CostTracker;

  const testUsage: TokenUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

  function seedDivision(code: string): void {
    db.prepare(
      "INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)",
    ).run(code, code);
  }

  function seedBudget(division: string, daily: number | null, monthly: number | null): void {
    db.prepare(
      `INSERT OR REPLACE INTO cost_budgets
         (division_code, daily_limit_usd, monthly_limit_usd, alert_threshold_percent)
       VALUES (?, ?, ?, 80)`,
    ).run(division, daily, monthly);
  }

  function ledgerRows(division: string): { cost_usd: number; cost_type: string }[] {
    return db.prepare(
      "SELECT cost_usd, cost_type FROM cost_ledger WHERE division_code = ?",
    ).all(division) as { cost_usd: number; cost_type: string }[];
  }

  beforeEach(() => {
    tmpDir  = mkdtempSync(join(tmpdir(), "sidjua-b9-test-"));
    db      = openDatabase(join(tmpDir, "test.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db, MIGRATIONS);
    seedDivision("eng");
    tracker = new CostTracker(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns allowed=true and a non-null reservationId when within budget", () => {
    seedBudget("eng", 1.0, null);
    const { result, reservationId } = tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 0.10);
    expect(result.allowed).toBe(true);
    expect(reservationId).toBeTypeOf("number");
    expect(reservationId).toBeGreaterThan(0);
  });

  it("inserts a 'reserved' row in cost_ledger on successful check", () => {
    seedBudget("eng", 1.0, null);
    tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 0.10);
    const rows = ledgerRows("eng");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_type).toBe("reserved");
    expect(rows[0]!.cost_usd).toBeCloseTo(0.10);
  });

  it("returns allowed=false and null reservationId when budget exceeded", () => {
    seedBudget("eng", 0.05, null);
    const { result, reservationId } = tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 0.10);
    expect(result.allowed).toBe(false);
    expect(reservationId).toBeNull();
  });

  it("no row inserted in cost_ledger when budget exceeded", () => {
    seedBudget("eng", 0.05, null);
    tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 0.10);
    expect(ledgerRows("eng")).toHaveLength(0);
  });

  it("finalizeReservation updates reservation to 'actual' with real cost", () => {
    seedBudget("eng", 1.0, null);
    const { reservationId } = tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 0.20);
    expect(reservationId).not.toBeNull();
    tracker.finalizeReservation(reservationId!, "anthropic", "claude-sonnet-4-6", testUsage, 0.15);
    const rows = ledgerRows("eng");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_type).toBe("actual");
    expect(rows[0]!.cost_usd).toBeCloseTo(0.15);
  });

  it("cancelReservation sets cost_usd to 0 and marks 'cancelled'", () => {
    seedBudget("eng", 1.0, null);
    const { reservationId } = tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 0.20);
    expect(reservationId).not.toBeNull();
    tracker.cancelReservation(reservationId!);
    const rows = ledgerRows("eng");
    expect(rows[0]!.cost_type).toBe("cancelled");
    expect(rows[0]!.cost_usd).toBe(0);
  });

  it("two concurrent calls that together exceed budget: second is blocked", () => {
    // Budget: $0.15; each call estimates $0.10.
    // First call passes and reserves $0.10.
    // Second call sees reserved $0.10 + estimated $0.10 = $0.20 > $0.15 → denied.
    seedBudget("eng", 0.15, null);

    const r1 = tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 0.10);
    const r2 = tracker.atomicCheckAndReserve("eng", "agent-2", "anthropic", "claude-sonnet-4-6", 0.10);

    expect(r1.result.allowed).toBe(true);
    expect(r2.result.allowed).toBe(false);
    expect(r2.reservationId).toBeNull();
  });

  it("no budget row → unlimited, allowed=true with reservationId", () => {
    // No seedBudget — unlimited
    const { result, reservationId } = tracker.atomicCheckAndReserve("eng", "agent-1", "anthropic", "claude-sonnet-4-6", 999.0);
    expect(result.allowed).toBe(true);
    expect(reservationId).not.toBeNull();
  });

  it("cost-tracker.ts source uses db.transaction().immediate() (B9 structural check)", () => {
    const src = readFileSync(
      new URL("../../src/provider/cost-tracker.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("atomicCheckAndReserve");
    expect(src).toContain(".immediate()");
    expect(src).toContain("finalizeReservation");
    expect(src).toContain("cancelReservation");
  });
});

// ===========================================================================
// H11: DB schema init — exclusive transaction + busy_timeout
// ===========================================================================

describe("H11 #519: openCliDatabase — exclusive schema init + busy_timeout", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-h11-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("db-init.ts source contains BEGIN EXCLUSIVE transaction wrapper", () => {
    const src = readFileSync(
      new URL("../../src/cli/utils/db-init.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain(".exclusive()");
  });

  it("db-init.ts source sets busy_timeout pragma (H11 #519)", () => {
    const src = readFileSync(
      new URL("../../src/cli/utils/db-init.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("busy_timeout");
  });

  it("busy_timeout value is ≥ 1000ms", () => {
    const src = readFileSync(
      new URL("../../src/cli/utils/db-init.ts", import.meta.url),
      "utf-8",
    );
    // Extract the numeric value after "busy_timeout ="
    const match = src.match(/busy_timeout\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const timeoutMs = parseInt(match![1]!, 10);
    expect(timeoutMs).toBeGreaterThanOrEqual(1000);
  });

  it("schema applied idempotently: second exclusive call does not throw", () => {
    // Open a real DB and apply schema twice via transaction().exclusive()
    const db = openDatabase(join(tmpDir, "test.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    runMigrations(db, MIGRATIONS);

    // Applying again inside an exclusive transaction must succeed (IF NOT EXISTS)
    expect(() => {
      db.transaction(() => {
        runMigrations(db, MIGRATIONS);
      }).exclusive();
    }).not.toThrow();

    db.close();
  });

  it("tables exist after schema init (smoke test)", () => {
    const db = openDatabase(join(tmpDir, "test2.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    runMigrations(db, MIGRATIONS);

    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: { name: string }) => r.name);

    expect(tables).toContain("divisions");
    expect(tables).toContain("cost_budgets");
    expect(tables).toContain("cost_ledger");

    db.close();
  });
});
