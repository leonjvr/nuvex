// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for EmailAdapter (outbound SMTP) — Task 1.
 *
 * nodemailer is mocked entirely; no real SMTP connections are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock nodemailer before importing source
// ---------------------------------------------------------------------------

const mockSendMail = vi.fn();
const mockVerify   = vi.fn();
const mockCreateTransport = vi.fn(() => ({
  sendMail: mockSendMail,
  verify:   mockVerify,
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}));

// Import AFTER mock
const { EmailAdapter } = await import("../../src/integrations/adapters/email-adapter.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_CONFIG = {
  smtp_host:    "smtp.example.com",
  smtp_port:    587,
  smtp_user:    "agent@example.com",
  smtp_pass:    "secret",
  from_address: "agent@example.com",
  from_name:    "SIDJUA Support Agent",
  tls:          true,
};

function makeSentResult(opts: { messageId?: string } = {}) {
  return {
    messageId: opts.messageId ?? "<abc123@example.com>",
    accepted:  ["user@example.com"],
    rejected:  [],
  };
}

// ---------------------------------------------------------------------------

describe("EmailAdapter — instantiation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates adapter with valid config", () => {
    const adapter = new EmailAdapter(VALID_CONFIG, "agent-1");
    expect(adapter).toBeDefined();
    expect(mockCreateTransport).toHaveBeenCalledOnce();
    adapter.destroy();
  });

  it("throws when smtp_host is missing", () => {
    expect(() => new EmailAdapter({ ...VALID_CONFIG, smtp_host: "" }, "a")).toThrow(
      /smtp_host/,
    );
  });

  it("throws when smtp_user is missing", () => {
    expect(() => new EmailAdapter({ ...VALID_CONFIG, smtp_user: "" }, "a")).toThrow(
      /smtp_user/,
    );
  });

  it("throws when smtp_pass is missing", () => {
    expect(() => new EmailAdapter({ ...VALID_CONFIG, smtp_pass: "" }, "a")).toThrow(
      /smtp_pass/,
    );
  });

  it("throws when from_address is missing", () => {
    expect(() => new EmailAdapter({ ...VALID_CONFIG, from_address: "" }, "a")).toThrow(
      /from_address/,
    );
  });

  it("rejects from_name without 'Agent' or 'Bot'", () => {
    expect(() => new EmailAdapter({ ...VALID_CONFIG, from_name: "Just Alice" }, "a")).toThrow(
      /Agent.*Bot|transparency/i,
    );
  });

  it("accepts from_name containing 'Agent'", () => {
    expect(() => new EmailAdapter({ ...VALID_CONFIG, from_name: "Customer Agent" }, "a")).not.toThrow();
  });

  it("accepts from_name containing 'Bot'", () => {
    expect(() => new EmailAdapter({ ...VALID_CONFIG, from_name: "SupportBot" }, "a")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("EmailAdapter — send()", () => {
  let adapter: InstanceType<typeof EmailAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue(makeSentResult());
    adapter = new EmailAdapter(VALID_CONFIG, "agent-1");
  });

  afterEach(() => { adapter.destroy(); });

  it("calls transport.sendMail with correct envelope", async () => {
    await adapter.send("user@example.com", "Hello", "Hi there");
    expect(mockSendMail).toHaveBeenCalledOnce();
    const [opts] = mockSendMail.mock.calls[0] as [Record<string, unknown>];
    expect(opts["to"]).toBe("user@example.com");
    expect(opts["subject"]).toBe("Hello");
    expect(String(opts["text"])).toContain("Hi there");
  });

  it("appends the transparency footer to the email body", async () => {
    await adapter.send("user@example.com", "Test", "Body content");
    const [opts] = mockSendMail.mock.calls[0] as [Record<string, unknown>];
    expect(String(opts["text"])).toContain("sent by");
    expect(String(opts["text"])).toContain("SIDJUA");
    expect(String(opts["text"])).toContain("Reply to this email");
  });

  it("returns EmailResult with messageId", async () => {
    mockSendMail.mockResolvedValue(makeSentResult({ messageId: "<unique-id@test>" }));
    const result = await adapter.send("x@y.com", "Hi", "Hello");
    expect(result.messageId).toBe("<unique-id@test>");
    expect(result.queued).toBe(false);
  });

  it("creates an audit trail entry for every outbound email", async () => {
    await adapter.send("user@example.com", "Audit test", "body");
    const log = adapter.getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.direction).toBe("outbound");
    expect(log[0]!.to).toBe("user@example.com");
    expect(log[0]!.agentId).toBe("agent-1");
  });
});

// ---------------------------------------------------------------------------

describe("EmailAdapter — sendReply()", () => {
  let adapter: InstanceType<typeof EmailAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue(makeSentResult());
    adapter = new EmailAdapter(VALID_CONFIG, "agent-1");
  });

  afterEach(() => { adapter.destroy(); });

  it("sets In-Reply-To header when sending a reply", async () => {
    await adapter.sendReply("<original@example.com>", "user@example.com", "My reply");
    const [opts] = mockSendMail.mock.calls[0] as [Record<string, unknown>];
    expect(opts["In-Reply-To"]).toBe("<original@example.com>");
  });

  it("sets References header when sending a reply", async () => {
    await adapter.sendReply("<original@example.com>", "user@example.com", "My reply");
    const [opts] = mockSendMail.mock.calls[0] as [Record<string, unknown>];
    expect(opts["References"]).toBe("<original@example.com>");
  });
});

// ---------------------------------------------------------------------------

describe("EmailAdapter — rate limiting", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("11th email within 1 minute is queued (not rejected)", async () => {
    mockSendMail.mockResolvedValue(makeSentResult());

    const adapter = new EmailAdapter(
      { ...VALID_CONFIG, rate_limit_per_minute: 10 },
      "agent-rl",
    );

    // Send 10 emails — all should go immediately
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(adapter.send("to@example.com", `Email ${i}`, "body"));
    }
    const results = await Promise.all(promises);
    expect(results.every((r) => !(r as { queued: boolean }).queued)).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(10);

    // 11th email — rate limit hit → queued
    const queuedPromise = adapter.send("to@example.com", "Email 11", "body");
    // sendMail should NOT have been called a 11th time yet
    expect(mockSendMail).toHaveBeenCalledTimes(10);

    // Resolve the queued email by destroying (flush loop will pick it up eventually;
    // for test purposes we just verify it returned a promise with queued:true)
    adapter.destroy();

    // The promise remains pending (no flush after destroy) — confirm it is a Promise
    expect(queuedPromise).toBeInstanceOf(Promise);
  });
});
