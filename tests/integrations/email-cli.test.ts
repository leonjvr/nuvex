// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for Task 3 (CLI commands) and Task 4 (zero-config email setup).
 *
 * nodemailer and imapflow are mocked; CLI commands run in-process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock nodemailer (for email-adapter used by CLI commands)
// ---------------------------------------------------------------------------

const {
  mockSendMail,
  mockVerify,
  mockImapConnect,
  mockImapLogout,
} = vi.hoisted(() => ({
  mockSendMail:   vi.fn(),
  mockVerify:     vi.fn(),
  mockImapConnect: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
  mockImapLogout:  vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify:   mockVerify,
    })),
  },
}));

// A real class mock so `new ImapFlow()` works after clearAllMocks()
vi.mock("imapflow", () => ({
  ImapFlow: class MockImapFlow {
    connect() { return mockImapConnect(); }
    logout()  { return mockImapLogout(); }
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { runEmailStatus, runEmailTest, runEmailThreads } = await import(
  "../../src/cli/commands/email.js"
);
const { writeEmailEnv, generateEmailYaml, testSmtpConnection, testImapConnection } = await import(
  "../../src/integrations/adapters/email-init.js"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SMTP_CFG = {
  smtp_host:    "smtp.example.com",
  smtp_port:    587,
  smtp_user:    "agent@example.com",
  smtp_pass:    "secret",
  from_address: "agent@example.com",
  from_name:    "SIDJUA Support Agent",
  tls:          true,
};

const IMAP_CFG = {
  imap_host:             "imap.example.com",
  imap_port:             993,
  imap_user:             "agent@example.com",
  imap_pass:             "secret",
  poll_interval_seconds: 30,
  tls:                   true,
};

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sidjua-email-cli-"));
  mkdirSync(join(dir, ".system"), { recursive: true });
  return dir;
}

const FULL_ENV = [
  "SIDJUA_SMTP_HOST=smtp.example.com",
  "SIDJUA_SMTP_PORT=587",
  "SIDJUA_SMTP_USER=agent@example.com",
  "SIDJUA_SMTP_PASS=secret",
  "SIDJUA_EMAIL_FROM=agent@example.com",
  "SIDJUA_AGENT_NAME=SIDJUA Support Agent",
  "SIDJUA_IMAP_HOST=imap.example.com",
  "SIDJUA_IMAP_PORT=993",
  "SIDJUA_IMAP_USER=agent@example.com",
  "SIDJUA_IMAP_PASS=secret",
].join("\n");

// ---------------------------------------------------------------------------
// Task 3: CLI — email status
// ---------------------------------------------------------------------------

describe("Task 3: sidjua email status", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.clearAllMocks();
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("shows 'NOT configured' when no .env exists", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });

    const code = await runEmailStatus({ workDir: tmpDir });
    expect(code).toBe(0);
    expect(out.some((s) => s.includes("NOT configured") || s.includes("No email"))).toBe(true);
  });

  it("shows adapter info when .env is configured", async () => {
    writeFileSync(join(tmpDir, ".env"), FULL_ENV, "utf-8");

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });

    const code = await runEmailStatus({ workDir: tmpDir, reveal: true });
    expect(code).toBe(0);
    const combined = out.join("");
    expect(combined).toContain("smtp.example.com");
    expect(combined).toContain("agent@example.com");
  });
});

// ---------------------------------------------------------------------------
// Task 3: CLI — email test
// ---------------------------------------------------------------------------

describe("Task 3: sidjua email test", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue({
      messageId: "<test-id@example.com>",
      accepted:  ["agent@example.com"],
      rejected:  [],
    });
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("sends test email when config is present", async () => {
    writeFileSync(join(tmpDir, ".env"), FULL_ENV, "utf-8");

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });

    const code = await runEmailTest({ agentId: "agent-1", workDir: tmpDir });
    expect(code).toBe(0);
    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(out.some((s) => s.includes("✓"))).toBe(true);
  });

  it("returns error code when config is missing", async () => {
    const err: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => { err.push(String(s)); return true; });

    const code = await runEmailTest({ agentId: "agent-1", workDir: tmpDir });
    expect(code).toBe(1);
    expect(err.some((s) => s.includes("not fully configured"))).toBe(true);
  });

  it("uses custom --to address when provided", async () => {
    writeFileSync(join(tmpDir, ".env"), FULL_ENV, "utf-8");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runEmailTest({ agentId: "agent-1", to: "boss@example.com", workDir: tmpDir });

    const [opts] = mockSendMail.mock.calls[0] as [Record<string, unknown>];
    expect(opts["to"]).toBe("boss@example.com");
  });
});

// ---------------------------------------------------------------------------
// Task 3: CLI — email threads
// ---------------------------------------------------------------------------

import BetterSqlite3 from "better-sqlite3";

describe("Task 3: sidjua email threads", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    vi.clearAllMocks();
  });

  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("lists threads from SQLite database", async () => {
    const dbPath = join(tmpDir, ".system", "sidjua.db");
    const db     = new BetterSqlite3(dbPath);
    db.exec(`
      CREATE TABLE email_threads (
        thread_id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        in_reply_to TEXT, from_address TEXT NOT NULL, subject TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `);
    db.prepare(
      "INSERT INTO email_threads VALUES (?,?,NULL,'a@b.com','Subj','agent-1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
    ).run("t1", "<m1@x>");
    db.close();

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });

    const code = await runEmailThreads({ agentId: "agent-1", workDir: tmpDir, json: false });
    expect(code).toBe(0);
    expect(out.some((s) => s.includes("t1"))).toBe(true);
  });

  it("returns JSON output with --json flag", async () => {
    const dbPath = join(tmpDir, ".system", "sidjua.db");
    const db     = new BetterSqlite3(dbPath);
    db.exec(`
      CREATE TABLE email_threads (
        thread_id TEXT PRIMARY KEY, message_id TEXT NOT NULL,
        in_reply_to TEXT, from_address TEXT NOT NULL, subject TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `);
    db.close();

    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => { out.push(String(s)); return true; });

    await runEmailThreads({ agentId: "agent-1", workDir: tmpDir, json: true });
    const combined = out.join("");
    expect(() => JSON.parse(combined)).not.toThrow();
  });

  it("reports error when no database exists", async () => {
    const err: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((s) => { err.push(String(s)); return true; });

    const code = await runEmailThreads({ agentId: "agent-1", workDir: tmpDir, json: false });
    expect(code).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Zero-config email setup helpers
// ---------------------------------------------------------------------------

describe("Task 4: writeEmailEnv — persist .env entries", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("writes SMTP vars to .env", async () => {
    await writeEmailEnv(tmpDir, { smtp: SMTP_CFG, imap: IMAP_CFG });
    const content = readFileSync(join(tmpDir, ".env"), "utf-8");
    expect(content).toContain("SIDJUA_SMTP_HOST=smtp.example.com");
    expect(content).toContain("SIDJUA_SMTP_USER=agent@example.com");
    expect(content).toContain("SIDJUA_EMAIL_FROM=agent@example.com");
  });

  it("writes IMAP vars to .env", async () => {
    await writeEmailEnv(tmpDir, { smtp: SMTP_CFG, imap: IMAP_CFG });
    const content = readFileSync(join(tmpDir, ".env"), "utf-8");
    expect(content).toContain("SIDJUA_IMAP_HOST=imap.example.com");
    expect(content).toContain("SIDJUA_IMAP_USER=agent@example.com");
    expect(content).toContain("SIDJUA_IMAP_PORT=993");
  });

  it("appends to existing .env without overwriting", async () => {
    writeFileSync(join(tmpDir, ".env"), "EXISTING_VAR=hello\n", "utf-8");
    await writeEmailEnv(tmpDir, { smtp: SMTP_CFG, imap: IMAP_CFG });
    const content = readFileSync(join(tmpDir, ".env"), "utf-8");
    expect(content).toContain("EXISTING_VAR=hello");
    expect(content).toContain("SIDJUA_SMTP_HOST");
  });
});

describe("Task 4: generateEmailYaml — agent YAML snippet", () => {
  it("contains communication.email.enabled: true", () => {
    const yaml = generateEmailYaml({ smtp: SMTP_CFG, imap: IMAP_CFG });
    expect(yaml).toContain("enabled: true");
    expect(yaml).toContain("communication:");
    expect(yaml).toContain("email:");
  });

  it("contains SMTP env var placeholders", () => {
    const yaml = generateEmailYaml({ smtp: SMTP_CFG, imap: IMAP_CFG });
    expect(yaml).toContain("SIDJUA_SMTP_HOST");
    expect(yaml).toContain("SIDJUA_SMTP_PASS");
    expect(yaml).toContain("SIDJUA_EMAIL_FROM");
  });

  it("contains IMAP inbound section", () => {
    const yaml = generateEmailYaml({ smtp: SMTP_CFG, imap: IMAP_CFG });
    expect(yaml).toContain("inbound:");
    expect(yaml).toContain("SIDJUA_IMAP_HOST");
    expect(yaml).toContain("poll_interval_seconds: 30");
  });
});

describe("Task 4: testSmtpConnection — SMTP verification", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns true when SMTP verify succeeds", async () => {
    mockVerify.mockResolvedValue(true);
    const result = await testSmtpConnection(SMTP_CFG);
    expect(result).toBe(true);
    expect(mockVerify).toHaveBeenCalledOnce();
  });

  it("returns false when SMTP verify throws", async () => {
    mockVerify.mockRejectedValue(new Error("Connection refused"));
    const result = await testSmtpConnection(SMTP_CFG);
    expect(result).toBe(false);
  });
});

describe("Task 4: testImapConnection — IMAP verification", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns true when IMAP login succeeds", async () => {
    mockImapConnect.mockResolvedValue(undefined);
    mockImapLogout.mockResolvedValue(undefined);
    const result = await testImapConnection(IMAP_CFG);
    expect(result).toBe(true);
  });

  it("returns false when IMAP connection throws", async () => {
    mockImapConnect.mockRejectedValue(new Error("Auth failed"));
    const result = await testImapConnection(IMAP_CFG);
    expect(result).toBe(false);
  });
});
