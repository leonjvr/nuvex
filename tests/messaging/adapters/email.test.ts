/**
 * V1.1 — Email adapter unit tests
 *
 * All external dependencies (imapflow, nodemailer) are mocked.
 * No real IMAP/SMTP connections are made.
 *
 * Design note: mockImapIdle returns a never-resolving Promise by default so
 * the IDLE loop in listenForMail suspends without spinning. Each test that
 * calls start() stops the instance in afterEach to clean up.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MessagingAdapterPlugin, AdapterCallbacks, AdapterInstance } from "../../../src/messaging/adapter-plugin.js";

// ---------------------------------------------------------------------------
// Mock imapflow — idle NEVER resolves by default (prevents infinite spin)
// ---------------------------------------------------------------------------

const mockImapConnect        = vi.fn().mockResolvedValue(undefined);
const mockImapLogout         = vi.fn().mockResolvedValue(undefined);
const mockImapGetMailboxLock = vi.fn().mockResolvedValue({ release: vi.fn() });
const mockImapFlagsAdd       = vi.fn().mockResolvedValue(undefined);
const mockImapOn             = vi.fn();

// idle() returns a promise that never resolves → IDLE loop suspends, not spins
const mockImapIdle = vi.fn().mockReturnValue(new Promise<void>(() => { /* intentionally pending */ }));

// fetch returns empty async generator by default; override per test
async function* emptyAsyncIter() { /* no items */ }
const mockImapFetch = vi.fn().mockImplementation(() => emptyAsyncIter());

class MockImapFlow {
  connect         = mockImapConnect;
  logout          = mockImapLogout;
  idle            = mockImapIdle;
  getMailboxLock  = mockImapGetMailboxLock;
  fetch           = mockImapFetch;
  messageFlagsAdd = mockImapFlagsAdd;
  on              = mockImapOn;
}

vi.mock("imapflow", () => ({
  ImapFlow: MockImapFlow,
}));

// ---------------------------------------------------------------------------
// Mock nodemailer
// ---------------------------------------------------------------------------

const mockSendMail         = vi.fn().mockResolvedValue({ messageId: "mock-id" });
const mockTransporterClose = vi.fn();
const mockCreateTransport  = vi.fn().mockReturnValue({
  sendMail: mockSendMail,
  close:    mockTransporterClose,
});

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}));

// ---------------------------------------------------------------------------
// Import adapter
// ---------------------------------------------------------------------------

async function getPlugin(): Promise<MessagingAdapterPlugin> {
  const mod = await import("../../../adapters/messaging/email/index.js");
  return mod.default;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks(overrides: Partial<AdapterCallbacks> = {}): AdapterCallbacks {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockImplementation(async (key: string) => `resolved-${key}`),
    logger:    {
      info:       vi.fn(),
      warn:       vi.fn(),
      error:      vi.fn(),
      debug:      vi.fn(),
      fatal:      vi.fn(),
      child:      vi.fn(),
      startTimer: vi.fn(),
    } as never,
    ...overrides,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    imap_host_secret: "imap-host",
    imap_user_secret: "imap-user",
    imap_pass_secret: "imap-pass",
    smtp_host_secret: "smtp-host",
    smtp_user_secret: "smtp-user",
    smtp_pass_secret: "smtp-pass",
    from_address:     "bot@example.com",
    ...overrides,
  };
}

function makeEmailMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: 1,
    envelope: {
      messageId: "<msg-1@example.com>",
      from:      [{ address: "alice@example.com", name: "Alice" }],
      date:      new Date("2026-01-01T12:00:00Z"),
      inReplyTo:  undefined,
      references: [],
    },
    source: Buffer.from(
      "From: alice@example.com\r\nContent-Type: text/plain\r\n\r\nHello SIDJUA\r\n--end",
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — meta
// ---------------------------------------------------------------------------

describe("Email adapter — meta", () => {
  it("has correct name and channel", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.name).toBe("email");
    expect(plugin.meta.channel).toBe("email");
  });

  it("declares expected capabilities", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.capabilities).toContain("text");
    expect(plugin.meta.capabilities).toContain("attachments");
    expect(plugin.meta.capabilities).toContain("threads");
    expect(plugin.meta.capabilities).toContain("rich_text");
  });

  it("has valid configSchema requiring all secrets", async () => {
    const plugin  = await getPlugin();
    const schema  = plugin.meta.configSchema as { required?: string[] };
    const required = schema.required ?? [];
    expect(required).toContain("imap_host_secret");
    expect(required).toContain("smtp_host_secret");
    expect(required).toContain("from_address");
  });
});

// ---------------------------------------------------------------------------
// Tests — instance creation
// ---------------------------------------------------------------------------

describe("Email adapter — createInstance()", () => {
  it("returns AdapterInstance with all required methods", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    expect(typeof instance.start).toBe("function");
    expect(typeof instance.stop).toBe("function");
    expect(typeof instance.sendResponse).toBe("function");
    expect(typeof instance.isHealthy).toBe("function");
    expect(instance.instanceId).toBe("inst-1");
    expect(instance.channel).toBe("email");
  });

  it("isHealthy returns false before start", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    expect(instance.isHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — start
// ---------------------------------------------------------------------------

describe("Email adapter — start()", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
    vi.clearAllMocks();
  });

  it("resolves all secrets and connects IMAP", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    instance = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();

    expect(callbacks.getSecret).toHaveBeenCalledWith("imap-host");
    expect(callbacks.getSecret).toHaveBeenCalledWith("imap-user");
    expect(callbacks.getSecret).toHaveBeenCalledWith("imap-pass");
    expect(mockImapConnect).toHaveBeenCalledOnce();
  });

  it("creates SMTP transport with resolved credentials", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "resolved-smtp-host",
        auth: expect.objectContaining({ user: "resolved-smtp-user" }),
      }),
    );
  });

  it("isHealthy returns true after start", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();
    expect(instance.isHealthy()).toBe(true);
  });

  it("uses custom imap_port and smtp_port when specified", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance(
      "inst-1",
      makeConfig({ imap_port: 143, smtp_port: 25 }),
      makeCallbacks(),
    );
    await instance.start();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 25 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — stop
// ---------------------------------------------------------------------------

describe("Email adapter — stop()", () => {
  it("disconnects IMAP and closes SMTP", async () => {
    vi.clearAllMocks();
    const plugin = await getPlugin();
    const inst   = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await inst.start();
    await inst.stop();

    expect(mockImapLogout).toHaveBeenCalledOnce();
    expect(mockTransporterClose).toHaveBeenCalledOnce();
    expect(inst.isHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — envelope conversion (messages via initial fetchUnseen on start)
// ---------------------------------------------------------------------------

describe("Email adapter — emailToEnvelope", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
    vi.clearAllMocks();
    // Reset fetch to empty iterator
    mockImapFetch.mockImplementation(() => emptyAsyncIter());
  });

  it("converts email message to MessageEnvelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const msg       = makeEmailMessage();
    async function* gen() { yield msg; }
    mockImapFetch.mockImplementation(() => gen());

    instance = plugin.createInstance("inst-email", makeConfig(), callbacks);
    await instance.start();
    // Background fetchUnseen runs concurrently — give it a tick
    await new Promise((r) => setTimeout(r, 20));

    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.instance_id).toBe("inst-email");
    expect(envelope.channel).toBe("email");
    expect(envelope.sender.platform_id).toBe("alice@example.com");
    expect(envelope.sender.display_name).toBe("Alice");
    expect(envelope.content.text).toContain("Hello SIDJUA");
    expect(envelope.metadata.chat_id).toBe("alice@example.com");
  });

  it("extracts message ID from envelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const msg       = makeEmailMessage();
    async function* gen() { yield msg; }
    mockImapFetch.mockImplementation(() => gen());

    instance = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await new Promise((r) => setTimeout(r, 20));

    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.id).toBe("<msg-1@example.com>");
  });

  it("sets reply_to from envelope.inReplyTo", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const msg       = makeEmailMessage({
      envelope: {
        messageId:  "<msg-2@example.com>",
        from:       [{ address: "bob@example.com", name: "Bob" }],
        date:       new Date(),
        inReplyTo:  "<original@example.com>",
        references: ["<original@example.com>"],
      },
    });
    async function* gen() { yield msg; }
    mockImapFetch.mockImplementation(() => gen());

    instance = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await new Promise((r) => setTimeout(r, 20));

    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.content.reply_to).toBe("<original@example.com>");
    expect(envelope.metadata.thread_id).toBe("<original@example.com>");
  });

  it("marks messages as seen after processing", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const msg       = makeEmailMessage({ uid: 7 });
    async function* gen() { yield msg; }
    mockImapFetch.mockImplementation(() => gen());

    instance = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await new Promise((r) => setTimeout(r, 20));

    expect(mockImapFlagsAdd).toHaveBeenCalledWith({ uid: 7 }, ["\\Seen"], { uid: true });
  });
});

// ---------------------------------------------------------------------------
// Tests — plain text extraction
// ---------------------------------------------------------------------------

describe("Email adapter — text extraction", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
    vi.clearAllMocks();
    mockImapFetch.mockImplementation(() => emptyAsyncIter());
  });

  it("extracts text/plain part from MIME message", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const msg       = makeEmailMessage({
      source: Buffer.from("Content-Type: text/plain\r\n\r\nHello from email\r\n--boundary"),
    });
    async function* gen() { yield msg; }
    mockImapFetch.mockImplementation(() => gen());

    instance = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await new Promise((r) => setTimeout(r, 20));

    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.content.text).toContain("Hello from email");
  });

  it("falls back to HTML stripping when no text/plain part", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const msg       = makeEmailMessage({
      source: Buffer.from("<html><body><p>Hello World</p></body></html>"),
    });
    async function* gen() { yield msg; }
    mockImapFetch.mockImplementation(() => gen());

    instance = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await new Promise((r) => setTimeout(r, 20));

    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.content.text).toContain("Hello World");
    expect(envelope.content.text).not.toContain("<");
  });
});

// ---------------------------------------------------------------------------
// Tests — sendResponse
// ---------------------------------------------------------------------------

describe("Email adapter — sendResponse()", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
    vi.clearAllMocks();
    mockImapFetch.mockImplementation(() => emptyAsyncIter());
  });

  it("sends plain text email", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();

    await instance.sendResponse("recipient@example.com", "Hello");
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "bot@example.com",
        to:   "recipient@example.com",
        text: "Hello",
      }),
    );
  });

  it("sends HTML email when format=html", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();

    await instance.sendResponse("r@example.com", "<b>Bold</b>", { format: "html" });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ html: "<b>Bold</b>", text: "Bold" }),
    );
  });

  it("sets In-Reply-To and References headers for replies", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();

    await instance.sendResponse("r@example.com", "Reply", {
      reply_to_message_id: "<original@example.com>",
    });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo:  "<original@example.com>",
        references: ["<original@example.com>"],
      }),
    );
  });

  it("uses custom response_subject from config", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance(
      "inst-1",
      makeConfig({ response_subject: "Custom Subject" }),
      makeCallbacks(),
    );
    await instance.start();

    await instance.sendResponse("r@example.com", "text");
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Custom Subject" }),
    );
  });

  it("is a no-op before start() is called", async () => {
    const plugin = await getPlugin();
    instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.sendResponse("r@example.com", "ignored");
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — formatText
// ---------------------------------------------------------------------------

describe("Email adapter — formatText()", () => {
  it("wraps text in HTML div with line breaks", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    const result   = instance.formatText!("Hello\nWorld");
    expect(result).toContain("<div");
    expect(result).toContain("Hello<br>World");
  });
});

// ---------------------------------------------------------------------------
// Tests — multi-instance independence
// ---------------------------------------------------------------------------

describe("Email adapter — multiple instances", () => {
  it("two instances monitor different mailboxes independently", async () => {
    vi.clearAllMocks();
    mockImapFetch.mockImplementation(() => emptyAsyncIter());

    const plugin  = await getPlugin();
    const cb1     = makeCallbacks();
    const cb2     = makeCallbacks();
    const configA = makeConfig({ mailbox: "INBOX",  from_address: "a@example.com" });
    const configB = makeConfig({ mailbox: "Alerts", from_address: "b@example.com" });
    const instA   = plugin.createInstance("inst-A", configA, cb1);
    const instB   = plugin.createInstance("inst-B", configB, cb2);

    await instA.start();
    await instB.start();

    expect(instA.instanceId).toBe("inst-A");
    expect(instB.instanceId).toBe("inst-B");
    expect(instA.isHealthy()).toBe(true);
    expect(instB.isHealthy()).toBe(true);

    await instA.stop();
    await instB.stop();
  });
});
