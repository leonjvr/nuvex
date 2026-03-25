// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writePidFile,
  readPidFile,
  shouldHandleMessage,
  loadDaemonConfig,
} from "../../../src/modules/discord/gateway-daemon.js";
import type { GatewayMessage } from "../../../src/modules/discord/discord-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<GatewayMessage> = {}): GatewayMessage {
  return {
    id:          "m1",
    channel_id:  "ch1",
    guild_id:    "g1",
    author:      { id: "user1", username: "Alice" },
    content:     "hello",
    timestamp:   "2026-01-01T00:00:00Z",
    attachments: [],
    embeds:      [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("writePidFile / readPidFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-daemon-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Test 23 (from spec): PID file written on start
  it("writes PID and timestamp to pid file", () => {
    const pidFile = join(tmpDir, "gateway.pid");
    const before  = Date.now();

    writePidFile(pidFile, 12345);

    const info = readPidFile(pidFile);
    expect(info).not.toBeNull();
    expect(info!.pid).toBe(12345);
    expect(info!.startMs).toBeGreaterThanOrEqual(before);
  });

  it("returns null for missing pid file", () => {
    const result = readPidFile(join(tmpDir, "nonexistent.pid"));
    expect(result).toBeNull();
  });

  it("returns null for malformed pid file", () => {
    const pidFile = join(tmpDir, "bad.pid");
    writeFileSync(pidFile, "not-a-number\n");
    expect(readPidFile(pidFile)).toBeNull();
  });
});

describe("shouldHandleMessage", () => {
  const CHANNEL_IDS = new Set(["ch-support", "ch-bugs"]);

  // Test 25 (from spec): channel filter works
  it("returns true for messages in configured channels", () => {
    const msg = makeMessage({ channel_id: "ch-support" });
    expect(shouldHandleMessage(msg, CHANNEL_IDS)).toBe(true);
  });

  it("returns false for messages outside configured channels", () => {
    const msg = makeMessage({ channel_id: "ch-random" });
    expect(shouldHandleMessage(msg, CHANNEL_IDS)).toBe(false);
  });

  it("returns false for bot messages", () => {
    const msg = makeMessage({
      channel_id: "ch-support",
      author: { id: "bot1", username: "Bot", bot: true },
    });
    expect(shouldHandleMessage(msg, CHANNEL_IDS)).toBe(false);
  });

  it("returns false for DMs (no guild_id)", () => {
    const msg = makeMessage({ channel_id: "ch-support", guild_id: undefined });
    expect(shouldHandleMessage(msg, CHANNEL_IDS)).toBe(false);
  });
});

describe("loadDaemonConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads token from .env file and guild_id from config.yaml", () => {
    writeFileSync(join(tmpDir, ".env"),         "DISCORD_BOT_TOKEN=tok123\n");
    writeFileSync(join(tmpDir, "config.yaml"),  "guild_id: guild999\n");

    const config = loadDaemonConfig(tmpDir);
    expect(config.token).toBe("tok123");
    expect(config.guildId).toBe("guild999");
    expect(config.supportChannels).toContain("support");
    expect(config.bugChannels).toContain("bug-reports");
  });

  it("uses custom channel names from config.yaml", () => {
    writeFileSync(join(tmpDir, ".env"),        "DISCORD_BOT_TOKEN=tok\n");
    writeFileSync(join(tmpDir, "config.yaml"), "guild_id: g1\nsupport_channel: help\nbug_channel: issues\n");

    const config = loadDaemonConfig(tmpDir);
    expect(config.supportChannels).toContain("help");
    expect(config.bugChannels).toContain("issues");
  });

  it("throws if DISCORD_BOT_TOKEN is missing", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "config.yaml"), "guild_id: g1\n");

    expect(() => loadDaemonConfig(tmpDir)).toThrow("DISCORD_BOT_TOKEN");
  });
});
