// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Email Channel Initialisation Helpers
 *
 * Standalone functions used by `sidjua init` and `sidjua email setup` to
 * collect, validate, and persist SMTP/IMAP credentials to the workspace .env.
 *
 * Keeping this logic outside init.ts keeps the init wizard lean and makes
 * the email-specific code independently testable.
 */

import { writeFile, readFile } from "node:fs/promises";
import { existsSync }          from "node:fs";
import { join }                from "node:path";
import nodemailer              from "nodemailer";
import { ImapFlow }            from "imapflow";
import type { EmailAdapterConfig, EmailInboundConfig } from "./types.js";


export interface EmailInitConfig {
  smtp: EmailAdapterConfig;
  imap: EmailInboundConfig;
}


export const EMAIL_ENV_KEYS = {
  SMTP_HOST:    "SIDJUA_SMTP_HOST",
  SMTP_PORT:    "SIDJUA_SMTP_PORT",
  SMTP_USER:    "SIDJUA_SMTP_USER",
  SMTP_PASS:    "SIDJUA_SMTP_PASS",
  EMAIL_FROM:   "SIDJUA_EMAIL_FROM",
  AGENT_NAME:   "SIDJUA_AGENT_NAME",
  IMAP_HOST:    "SIDJUA_IMAP_HOST",
  IMAP_PORT:    "SIDJUA_IMAP_PORT",
  IMAP_USER:    "SIDJUA_IMAP_USER",
  IMAP_PASS:    "SIDJUA_IMAP_PASS",
} as const;


export async function writeEmailEnv(
  workDir: string,
  cfg:     EmailInitConfig,
): Promise<void> {
  const envPath = join(workDir, ".env");
  const existing = existsSync(envPath)
    ? await readFile(envPath, "utf-8")
    : "";

  const newLines: string[] = [
    "",
    "# Email communication channel",
    `${EMAIL_ENV_KEYS.SMTP_HOST}=${cfg.smtp.smtp_host}`,
    `${EMAIL_ENV_KEYS.SMTP_PORT}=${cfg.smtp.smtp_port}`,
    `${EMAIL_ENV_KEYS.SMTP_USER}=${cfg.smtp.smtp_user}`,
    `${EMAIL_ENV_KEYS.SMTP_PASS}=${cfg.smtp.smtp_pass}`,
    `${EMAIL_ENV_KEYS.EMAIL_FROM}=${cfg.smtp.from_address}`,
    `${EMAIL_ENV_KEYS.AGENT_NAME}=${cfg.smtp.from_name}`,
    `${EMAIL_ENV_KEYS.IMAP_HOST}=${cfg.imap.imap_host}`,
    `${EMAIL_ENV_KEYS.IMAP_PORT}=${cfg.imap.imap_port}`,
    `${EMAIL_ENV_KEYS.IMAP_USER}=${cfg.imap.imap_user}`,
    `${EMAIL_ENV_KEYS.IMAP_PASS}=${cfg.imap.imap_pass}`,
  ];

  await writeFile(envPath, existing + newLines.join("\n") + "\n", "utf-8");
}


export function generateEmailYaml(cfg: EmailInitConfig): string {
  return [
    "communication:",
    "  email:",
    "    enabled: true",
    `    smtp_host: \"\${SIDJUA_SMTP_HOST}\"`,
    `    smtp_port: \"\${SIDJUA_SMTP_PORT:${cfg.smtp.smtp_port}}\"`,
    `    smtp_user: \"\${SIDJUA_SMTP_USER}\"`,
    `    smtp_pass: \"\${SIDJUA_SMTP_PASS}\"`,
    `    from_address: \"\${SIDJUA_EMAIL_FROM}\"`,
    `    from_name: \"\${SIDJUA_AGENT_NAME}\"`,
    `    tls: ${cfg.smtp.tls}`,
    "    inbound:",
    "      enabled: true",
    `      imap_host: \"\${SIDJUA_IMAP_HOST}\"`,
    `      imap_port: \"\${SIDJUA_IMAP_PORT:${cfg.imap.imap_port}}\"`,
    `      imap_user: \"\${SIDJUA_IMAP_USER}\"`,
    `      imap_pass: \"\${SIDJUA_IMAP_PASS}\"`,
    `      poll_interval_seconds: ${cfg.imap.poll_interval_seconds}`,
    `      tls: ${cfg.imap.tls}`,
  ].join("\n");
}


export async function testSmtpConnection(smtp: EmailAdapterConfig): Promise<boolean> {
  const transport = nodemailer.createTransport({
    host:   smtp.smtp_host,
    port:   smtp.smtp_port,
    secure: smtp.smtp_port === 465,
    auth:   { user: smtp.smtp_user, pass: smtp.smtp_pass },
  });
  try {
    await transport.verify();
    return true;
  } catch (_err) {
    return false;
  }
}


export async function testImapConnection(imap: EmailInboundConfig): Promise<boolean> {
  const client = new ImapFlow({
    host:   imap.imap_host,
    port:   imap.imap_port,
    secure: imap.tls,
    auth:   { user: imap.imap_user, pass: imap.imap_pass },
    logger: false,
  });
  try {
    await client.connect();
    await client.logout();
    return true;
  } catch (_err) {
    return false;
  }
}
