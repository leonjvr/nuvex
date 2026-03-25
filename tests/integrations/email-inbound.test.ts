// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for EmailInboundPoller (IMAP polling) — Task 2.
 *
 * imapflow is mocked entirely; no real IMAP connections are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";

// ---------------------------------------------------------------------------
// Mock imapflow before importing source
// vi.hoisted ensures the mock fns are initialised before vi.mock() runs
// ---------------------------------------------------------------------------

// Use vi.hoisted so mock fns are available in the vi.mock factory below
const imapMocks = vi.hoisted(() => ({
  connect:         vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
  logout:          vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
  getMailboxLock:  vi.fn(),
  fetch:           vi.fn(),
  messageFlagsAdd: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
}));

// A real class so `new ImapFlow()` works correctly even after clearAllMocks()
vi.mock("imapflow", () => ({
  ImapFlow: class MockImapFlow {
    connect()                      { return imapMocks.connect(); }
    logout()                       { return imapMocks.logout(); }
    getMailboxLock(...a: unknown[]) { return imapMocks.getMailboxLock(...a); }
    fetch(...a: unknown[])         { return imapMocks.fetch(...a); }
    messageFlagsAdd(...a: unknown[]){ return imapMocks.messageFlagsAdd(...a); }
  },
}));

// Convenience aliases
const mockConnect        = imapMocks.connect;
const mockLogout         = imapMocks.logout;
const mockGetMailboxLock = imapMocks.getMailboxLock;
const mockFetch          = imapMocks.fetch;
const mockFlagsAdd       = imapMocks.messageFlagsAdd;

// Import AFTER mock
const { EmailInboundPoller } = await import("../../src/integrations/adapters/email-inbound.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_IMAP_CONFIG = {
  imap_host:             "imap.example.com",
  imap_port:             993,
  imap_user:             "agent@example.com",
  imap_pass:             "secret",
  poll_interval_seconds: 30,
  tls:                   true,
};

function makeDb() {
  return new BetterSqlite3(":memory:");
}

function noopCallback() {
  return async () => {};
}

/** Helper: make a mock async-iterable of IMAP messages */
async function* makeMessages(msgs: Array<{
  messageId: string; inReplyTo?: string; from: string; subject: string; body: string;
}>) {
  for (const msg of msgs) {
    yield {
      uid: 1,
      envelope: {
        messageId:  msg.messageId,
        inReplyTo:  msg.inReplyTo,
        from:       [{ address: msg.from }],
        to:         [{ address: "agent@example.com" }],
        subject:    msg.subject,
      },
      source: Buffer.from(`Content-Type: text/plain\r\n\r\n${msg.body}`, "utf-8"),
      bodyStructure: {},
    };
  }
}

// ---------------------------------------------------------------------------

describe("EmailInboundPoller — lifecycle", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("can be instantiated without connecting", () => {
    const poller = new EmailInboundPoller(VALID_IMAP_CONFIG, "agent-1", makeDb(), noopCallback());
    expect(poller).toBeDefined();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("start() connects to IMAP and begins polling", async () => {
    const lock = { release: vi.fn() };
    mockGetMailboxLock.mockResolvedValue(lock);
    mockFetch.mockImplementation(() => makeMessages([]));

    const poller = new EmailInboundPoller(VALID_IMAP_CONFIG, "agent-1", makeDb(), noopCallback());
    await poller.start();
    expect(mockConnect).toHaveBeenCalledOnce();
    await poller.stop();
  });

  it("start() is idempotent — second call is a no-op", async () => {
    const lock = { release: vi.fn() };
    mockGetMailboxLock.mockResolvedValue(lock);
    mockFetch.mockImplementation(() => makeMessages([]));

    const poller = new EmailInboundPoller(VALID_IMAP_CONFIG, "agent-1", makeDb(), noopCallback());
    await poller.start();
    await poller.start(); // second call
    expect(mockConnect).toHaveBeenCalledOnce();
    await poller.stop();
  });

  it("stop() logs out gracefully", async () => {
    const lock = { release: vi.fn() };
    mockGetMailboxLock.mockResolvedValue(lock);
    mockFetch.mockImplementation(() => makeMessages([]));

    const poller = new EmailInboundPoller(VALID_IMAP_CONFIG, "agent-1", makeDb(), noopCallback());
    await poller.start();
    await poller.stop();
    expect(mockLogout).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------

describe("EmailInboundPoller — poll()", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns emails fetched from IMAP", async () => {
    const lock = { release: vi.fn() };
    mockGetMailboxLock.mockResolvedValue(lock);
    // Use mockImplementation so each call to fetch() gets a FRESH generator
    mockFetch.mockImplementation(() => makeMessages([
      { messageId: "<m1@test>", from: "user@example.com", subject: "Hello", body: "Hello there" },
    ]));

    const poller = new EmailInboundPoller(
      VALID_IMAP_CONFIG, "agent-1", makeDb(),
      async () => {},
    );
    await poller.start();
    // poll() calls _poll() which fetches emails via the mock
    const emails = await poller.poll();
    await poller.stop();

    // At minimum 1 email from the explicit poll() call
    expect(emails.length).toBeGreaterThanOrEqual(1);
    expect(emails.some((e) => e.messageId === "<m1@test>")).toBe(true);
  });

  it("marks emails as read after fetching", async () => {
    const lock = { release: vi.fn() };
    mockGetMailboxLock.mockResolvedValue(lock);
    mockFetch.mockImplementation(() => makeMessages([
      { messageId: "<m2@test>", from: "user@example.com", subject: "Hi", body: "body" },
    ]));

    const poller = new EmailInboundPoller(VALID_IMAP_CONFIG, "agent-1", makeDb(), noopCallback());
    await poller.start();
    await poller.poll();
    await poller.stop();

    // messageFlagsAdd should have been called at least once (mark-as-seen)
    expect(mockFlagsAdd).toHaveBeenCalledWith(1, ["\\Seen"], { uid: true });
  });
});

// ---------------------------------------------------------------------------

describe("EmailInboundPoller — thread mapping", () => {
  it("creates a new thread for an email with no In-Reply-To", async () => {
    const threads: string[] = [];
    const poller = new EmailInboundPoller(
      VALID_IMAP_CONFIG, "agent-1", makeDb(),
      async (_email, threadId) => { threads.push(threadId); },
    );
    await poller.processEmail({
      messageId: "<new1@test>", from: "user@example.com", to: "agent@example.com",
      subject: "Fresh", body: "New conversation", receivedAt: new Date().toISOString(),
    });

    expect(threads).toHaveLength(1);
    expect(threads[0]).toBeTruthy();
    expect(threads[0]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("maps reply to an existing thread by In-Reply-To", async () => {
    const db = makeDb();
    // Pre-seed an existing thread
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_threads (
        thread_id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        in_reply_to TEXT, from_address TEXT NOT NULL, subject TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `);
    const existingThreadId = "existing-thread-uuid";
    const originalMsgId    = "<sent-by-agent@sidjua>";
    db.prepare(
      `INSERT INTO email_threads VALUES (?, ?, NULL, 'agent@s.com', 'Init', datetime('now'), datetime('now'))`,
    ).run(existingThreadId, originalMsgId);

    const threads: string[] = [];
    const poller = new EmailInboundPoller(
      VALID_IMAP_CONFIG, "agent-1", db,
      async (_email, threadId) => { threads.push(threadId); },
    );
    await poller.processEmail({
      messageId: "<reply1@test>", inReplyTo: originalMsgId,
      from: "user@example.com", to: "agent@example.com",
      subject: "Re: Init", body: "Thanks!", receivedAt: new Date().toISOString(),
    });

    expect(threads[0]).toBe(existingThreadId);
  });
});

// ---------------------------------------------------------------------------

describe("EmailInboundPoller — security", () => {
  it("ignores emails from non-whitelisted senders", async () => {
    const received: string[] = [];
    const poller = new EmailInboundPoller(
      { ...VALID_IMAP_CONFIG, whitelist: ["allowed@example.com"] },
      "agent-1", makeDb(),
      async (email) => { received.push(email.from); },
    );
    await poller.processEmail({
      messageId: "<spam@evil.com>", from: "attacker@evil.com", to: "agent@example.com",
      subject: "Win!", body: "Click here", receivedAt: new Date().toISOString(),
    });

    expect(received).toHaveLength(0);
  });

  it("accepts emails from whitelisted senders", async () => {
    const received: string[] = [];
    const poller = new EmailInboundPoller(
      { ...VALID_IMAP_CONFIG, whitelist: ["allowed@example.com"] },
      "agent-1", makeDb(),
      async (email) => { received.push(email.from); },
    );
    await poller.processEmail({
      messageId: "<ok@allowed.com>", from: "allowed@example.com", to: "agent@example.com",
      subject: "Hi", body: "Hello", receivedAt: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("allowed@example.com");
  });

  it("sends size-limit sentinel for oversized email bodies", async () => {
    const bigBody = "x".repeat(200);
    const bodies: string[] = [];
    const poller = new EmailInboundPoller(
      { ...VALID_IMAP_CONFIG, max_body_bytes: 100 },
      "agent-1", makeDb(),
      async (email) => { bodies.push(email.body); },
    );
    await poller.processEmail({
      messageId: "<big@test>", from: "user@example.com", to: "agent@example.com",
      subject: "Big", body: bigBody, receivedAt: new Date().toISOString(),
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("__SIDJUA_OVERSIZED__");
    expect(bodies[0]).toContain("max_bytes=100");
  });

  it("strips HTML tags from email body before forwarding to agent", async () => {
    const htmlBody = "<p>Hello <b>World</b>!</p><script>evil()</script>";
    const bodies: string[] = [];
    const poller = new EmailInboundPoller(
      VALID_IMAP_CONFIG, "agent-1", makeDb(),
      async (email) => { bodies.push(email.body); },
    );
    await poller.processEmail({
      messageId: "<html@test>", from: "user@example.com", to: "agent@example.com",
      subject: "HTML email", body: htmlBody, receivedAt: new Date().toISOString(),
    });

    expect(bodies[0]).not.toContain("<p>");
    expect(bodies[0]).not.toContain("<script>");
    expect(bodies[0]).toContain("Hello");
    expect(bodies[0]).toContain("World");
  });
});

// ---------------------------------------------------------------------------

describe("EmailInboundPoller — listThreads()", () => {
  it("returns all threads from the database", async () => {
    const db = makeDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_threads (
        thread_id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        in_reply_to TEXT, from_address TEXT NOT NULL, subject TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `);
    db.prepare(
      "INSERT INTO email_threads VALUES (?, ?, NULL, 'a@b.com', 'Sub', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run("t1", "<m1@x>");
    db.prepare(
      "INSERT INTO email_threads VALUES (?, ?, NULL, 'c@d.com', 'Sub2', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')",
    ).run("t2", "<m2@x>");

    const poller = new EmailInboundPoller(VALID_IMAP_CONFIG, "agent-1", db, noopCallback());
    const threads = poller.listThreads();
    expect(threads).toHaveLength(2);
  });
});
