// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua email` CLI commands
 *
 * Subcommands:
 *   status  — Show configured email adapters and connection status
 *   test    — Send a test email from the configured adapter
 *   threads — List active email thread conversations
 */

import { resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Command }  from "commander";
import { openDatabase }  from "../../utils/db.js";
import { EmailAdapter }  from "../../integrations/adapters/email-adapter.js";
import type { EmailAdapterConfig } from "../../integrations/adapters/types.js";
import { msg }           from "../../i18n/index.js";


export function registerEmailCommands(program: Command): void {
  const emailCmd = program
    .command("email")
    .description("Manage email communication channel");

  // ── status ────────────────────────────────────────────────────────────────
  emailCmd
    .command("status")
    .description("Show email adapter configuration and connection status")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--reveal", "Show credential values unmasked", false)
    .action(async (opts: { workDir: string; reveal: boolean }) => {
      const code = await runEmailStatus({ workDir: resolve(opts.workDir), reveal: opts.reveal });
      process.exit(code);
    });

  // ── test ──────────────────────────────────────────────────────────────────
  emailCmd
    .command("test <agentId>")
    .description("Send a test email from the configured adapter")
    .option("--to <address>",     "Recipient address (defaults to SMTP user)")
    .option("--work-dir <path>",  "Workspace directory", process.cwd())
    .action(async (agentId: string, opts: { to?: string; workDir: string }) => {
      const code = await runEmailTest({ agentId, workDir: resolve(opts.workDir), ...(opts.to !== undefined ? { to: opts.to } : {}) });
      process.exit(code);
    });

  // ── threads ───────────────────────────────────────────────────────────────
  emailCmd
    .command("threads <agentId>")
    .description("List active email threads for an agent")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .option("--json",            "Output as JSON", false)
    .action(async (agentId: string, opts: { workDir: string; json: boolean }) => {
      const code = await runEmailThreads({ agentId, workDir: resolve(opts.workDir), json: opts.json });
      process.exit(code);
    });
}


function maskHost(host: string): string {
  if (host.length <= 4) return "***";
  return host.slice(0, 4) + "***";
}

function maskEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return "***";
  return email[0] + "***" + email.slice(atIdx);
}

interface EmailStatusOptions { workDir: string; reveal?: boolean }

export async function runEmailStatus(opts: EmailStatusOptions): Promise<number> {
  const envPath = join(opts.workDir, ".env");
  if (!existsSync(envPath)) {
    process.stdout.write("No email configuration found.\n");
    process.stdout.write("Run `sidjua email setup` or add SIDJUA_SMTP_* variables to .env\n");
    return 0;
  }

  const env = loadEmailEnv(opts.workDir);

  if (!env.smtpHost) {
    process.stdout.write("Email channel: NOT configured\n");
    process.stdout.write("  Add SIDJUA_SMTP_HOST, SIDJUA_SMTP_USER, SIDJUA_SMTP_PASS to .env\n");
    return 0;
  }

  const reveal = opts.reveal === true;
  process.stdout.write("Email channel: configured\n");
  process.stdout.write(`  SMTP host:     ${reveal ? `${env.smtpHost}:${env.smtpPort ?? 587}` : `${maskHost(env.smtpHost)}:${env.smtpPort ?? 587}`}\n`);
  process.stdout.write(`  SMTP user:     ${env.smtpUser !== undefined ? (reveal ? env.smtpUser : maskEmail(env.smtpUser)) : "(not set)"}\n`);
  process.stdout.write(`  From address:  ${env.emailFrom !== undefined ? (reveal ? env.emailFrom : maskEmail(env.emailFrom)) : "(not set)"}\n`);
  process.stdout.write(`  Agent name:    ${env.agentName ?? "(not set)"}\n`);
  process.stdout.write(`  IMAP host:     ${env.imapHost !== undefined ? (reveal ? `${env.imapHost}:${env.imapPort ?? 993}` : `${maskHost(env.imapHost)}:${env.imapPort ?? 993}`) : "(not set)"}\n`);
  process.stdout.write(`  IMAP user:     ${env.imapUser !== undefined ? (reveal ? env.imapUser : maskEmail(env.imapUser)) : "(not set)"}\n`);
  if (!reveal) {
    process.stdout.write("  (Use --reveal to show full credential values)\n");
  }

  return 0;
}


interface EmailTestOptions {
  agentId: string;
  to?:     string;
  workDir: string;
}

export async function runEmailTest(opts: EmailTestOptions): Promise<number> {
  const env = loadEmailEnv(opts.workDir);

  if (!env.smtpHost || !env.smtpUser || !env.smtpPass || !env.emailFrom) {
    process.stderr.write("Email channel not fully configured — check SIDJUA_SMTP_* in .env\n");
    return 1;
  }

  const agentName = env.agentName && /agent|bot/i.test(env.agentName)
    ? env.agentName
    : "SIDJUA Agent";

  const config: EmailAdapterConfig = {
    smtp_host:    env.smtpHost,
    smtp_port:    env.smtpPort ?? 587,
    smtp_user:    env.smtpUser,
    smtp_pass:    env.smtpPass,
    from_address: env.emailFrom,
    from_name:    agentName,
    tls:          true,
  };

  const recipient = opts.to ?? env.smtpUser;

  try {
    const adapter = new EmailAdapter(config, opts.agentId);
    const result  = await adapter.send(
      recipient,
      "SIDJUA Email Test",
      `Hello!\n\nThis is a test email from SIDJUA agent '${opts.agentId}'.\n` +
      `If you received this, your email channel is working correctly.`,
    );
    adapter.destroy();

    process.stdout.write(`✓ Test email sent to ${recipient}\n`);
    process.stdout.write(`  Message-ID: ${result.messageId}\n`);
    return 0;
  } catch (err: unknown) {
    process.stderr.write(`✗ Test email failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}


interface EmailThreadsOptions {
  agentId: string;
  workDir: string;
  json:    boolean;
}

export async function runEmailThreads(opts: EmailThreadsOptions): Promise<number> {
  const dbPath = join(opts.workDir, ".system", "sidjua.db");
  if (!existsSync(dbPath)) {
    process.stderr.write("No SIDJUA database found. Run `sidjua init` first.\n");
    return 1;
  }

  const db = openDatabase(dbPath);

  // Schema is created by the email adapter init path — not here (read-only command)
  const hasTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='email_threads'",
  ).get();
  if (hasTable === undefined) {
    process.stderr.write(msg("email.threads_table_missing") + "\n");
    db.close();
    return 1;
  }

  const threads = db.prepare<[string], {
    thread_id:    string;
    message_id:   string;
    from_address: string;
    subject:      string;
    updated_at:   string;
  }>(
    "SELECT thread_id, message_id, from_address, subject, updated_at FROM email_threads WHERE agent_id = ? ORDER BY updated_at DESC",
  ).all(opts.agentId);

  db.close();

  if (opts.json) {
    process.stdout.write(JSON.stringify(threads, null, 2) + "\n");
    return 0;
  }

  if (threads.length === 0) {
    process.stdout.write(`No email threads found for agent '${opts.agentId}'.\n`);
    return 0;
  }

  process.stdout.write(`Email threads for agent '${opts.agentId}':\n\n`);
  for (const t of threads) {
    process.stdout.write(`  Thread: ${t.thread_id}\n`);
    process.stdout.write(`    From:    ${t.from_address}\n`);
    process.stdout.write(`    Subject: ${t.subject}\n`);
    process.stdout.write(`    Updated: ${t.updated_at}\n\n`);
  }

  return 0;
}


interface EmailEnv {
  smtpHost:  string | undefined;
  smtpPort:  number | undefined;
  smtpUser:  string | undefined;
  smtpPass:  string | undefined;
  emailFrom: string | undefined;
  agentName: string | undefined;
  imapHost:  string | undefined;
  imapPort:  number | undefined;
  imapUser:  string | undefined;
  imapPass:  string | undefined;
}

const EMPTY_ENV: EmailEnv = {
  smtpHost: undefined, smtpPort: undefined, smtpUser: undefined, smtpPass: undefined,
  emailFrom: undefined, agentName: undefined,
  imapHost: undefined, imapPort: undefined, imapUser: undefined, imapPass: undefined,
};

function loadEmailEnv(workDir: string): EmailEnv {
  const envPath = join(workDir, ".env");
  if (!existsSync(envPath)) return EMPTY_ENV;

  // Simple .env parser (no external dependency)
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf-8");
  } catch (_e) {
    return EMPTY_ENV;
  }

  const map: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    map[key] = val;
  }

  return {
    smtpHost:  map["SIDJUA_SMTP_HOST"],
    smtpPort:  map["SIDJUA_SMTP_PORT"] !== undefined ? parseInt(map["SIDJUA_SMTP_PORT"]!, 10) : undefined,
    smtpUser:  map["SIDJUA_SMTP_USER"],
    smtpPass:  map["SIDJUA_SMTP_PASS"],
    emailFrom: map["SIDJUA_EMAIL_FROM"],
    agentName: map["SIDJUA_AGENT_NAME"],
    imapHost:  map["SIDJUA_IMAP_HOST"],
    imapPort:  map["SIDJUA_IMAP_PORT"] !== undefined ? parseInt(map["SIDJUA_IMAP_PORT"]!, 10) : undefined,
    imapUser:  map["SIDJUA_IMAP_USER"],
    imapPass:  map["SIDJUA_IMAP_PASS"],
  };
}
