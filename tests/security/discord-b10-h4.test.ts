// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for #519 B10 and H4:
 *
 *   B10: Destructive Discord ops (manage_channel, manage_member) blocked by default
 *   H4a: Gateway config loading validates path within moduleDir
 *   H4b: Gateway config uses proper YAML parser (not regex)
 *   H4c: executeDiscordTool validates JSON args (object, action enum, bounds)
 */

import { describe, it, expect, vi }                     from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join }                                          from "node:path";
import { tmpdir }                                        from "node:os";
import {
  executeDiscordTool,
  DESTRUCTIVE_TOOLS,
} from "../../src/modules/discord/discord-tools.js";
import { loadDaemonConfig }  from "../../src/modules/discord/gateway-daemon.js";
import type { DiscordModuleConfig } from "../../src/modules/discord/discord-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    sendMessage:       vi.fn().mockResolvedValue({ id: "msg1" }),
    getMessages:       vi.fn().mockResolvedValue([]),
    createThread:      vi.fn().mockResolvedValue({ id: "t1", name: "thread" }),
    createChannel:     vi.fn().mockResolvedValue({ id: "ch_new", name: "new-channel" }),
    editChannel:       vi.fn().mockResolvedValue({ id: "ch1" }),
    deleteChannel:     vi.fn().mockResolvedValue(undefined),
    addRole:           vi.fn().mockResolvedValue(undefined),
    removeRole:        vi.fn().mockResolvedValue(undefined),
    kickMember:        vi.fn().mockResolvedValue(undefined),
    banMember:         vi.fn().mockResolvedValue(undefined),
    getGuild:          vi.fn().mockResolvedValue({ id: "g1", name: "Test Guild", icon: null }),
    listGuildChannels: vi.fn().mockResolvedValue([]),
    resolveChannelId:  vi.fn().mockResolvedValue("ch2"),
    ...overrides,
  };
}

const BASE_CONFIG: DiscordModuleConfig = { bot_token: "tok", guild_id: "g1" };
const DESTRUCTIVE_CONFIG: DiscordModuleConfig = { ...BASE_CONFIG, enableDestructiveOps: true };

// ===========================================================================
// B10: Destructive ops gate
// ===========================================================================

describe("B10 #519: Destructive Discord ops disabled by default", () => {
  it("DESTRUCTIVE_TOOLS set is exported and contains manage_channel", () => {
    expect(DESTRUCTIVE_TOOLS.has("discord_manage_channel")).toBe(true);
  });

  it("DESTRUCTIVE_TOOLS set contains manage_member", () => {
    expect(DESTRUCTIVE_TOOLS.has("discord_manage_member")).toBe(true);
  });

  it("discord_manage_channel blocked when enableDestructiveOps is not set (default)", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_channel",
      JSON.stringify({ action: "delete", channel_id: "ch1" }),
      client as never, BASE_CONFIG,
    );
    const parsed = JSON.parse(result) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("disabled by default");
    expect(client.deleteChannel).not.toHaveBeenCalled();
  });

  it("discord_manage_channel blocked when enableDestructiveOps=false", async () => {
    const client = makeClient();
    const cfg = { ...BASE_CONFIG, enableDestructiveOps: false };
    const result = await executeDiscordTool(
      "discord_manage_channel",
      JSON.stringify({ action: "create", guild_id: "g1", name: "test", type: "text" }),
      client as never, cfg,
    );
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(false);
    expect(client.createChannel).not.toHaveBeenCalled();
  });

  it("discord_manage_member blocked when enableDestructiveOps is not set", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1" }),
      client as never, BASE_CONFIG,
    );
    const parsed = JSON.parse(result) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("disabled by default");
    expect(client.kickMember).not.toHaveBeenCalled();
  });

  it("discord_manage_member ban blocked when enableDestructiveOps is not set", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "ban", guild_id: "g1", user_id: "u1" }),
      client as never, BASE_CONFIG,
    );
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(false);
    expect(client.banMember).not.toHaveBeenCalled();
  });

  it("discord_manage_channel allowed when enableDestructiveOps=true", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_channel",
      JSON.stringify({ action: "delete", channel_id: "ch1" }),
      client as never, DESTRUCTIVE_CONFIG,
    );
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
    expect(client.deleteChannel).toHaveBeenCalledWith("ch1");
  });

  it("discord_manage_member allowed when enableDestructiveOps=true", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1", reason: "spam" }),
      client as never, DESTRUCTIVE_CONFIG,
    );
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
    expect(client.kickMember).toHaveBeenCalledWith("g1", "u1", "spam");
  });

  it("non-destructive tools work regardless of enableDestructiveOps flag", async () => {
    const client = makeClient();
    // discord_send_message is not in DESTRUCTIVE_TOOLS
    const result = await executeDiscordTool(
      "discord_send_message",
      JSON.stringify({ channel_id: "ch1", content: "hello" }),
      client as never, BASE_CONFIG,  // no enableDestructiveOps
    );
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
    expect(client.sendMessage).toHaveBeenCalled();
  });
});

// ===========================================================================
// H4a: Path traversal in config loading
// ===========================================================================

describe("H4a #519: Gateway config loading — path validation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-h4a-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadDaemonConfig succeeds with valid moduleDir containing .env + config.yaml", () => {
    const moduleDir = join(tmpDir, "discord");
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, ".env"), "DISCORD_BOT_TOKEN=test-token\n");
    writeFileSync(join(moduleDir, "config.yaml"), "guild_id: '123456789012345678'\n");

    const cfg = loadDaemonConfig(moduleDir);
    expect(cfg.token).toBe("test-token");
    expect(cfg.guildId).toBe("123456789012345678");
  });

  it("loadDaemonConfig throws when moduleDir does not exist", () => {
    expect(() => loadDaemonConfig(join(tmpDir, "nonexistent"))).toThrow(/not found/i);
  });

  it("gateway-daemon.ts source imports assertWithinDirectory (H4a structural check)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../src/modules/discord/gateway-daemon.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("assertWithinDirectory");
    expect(src).toContain("path-utils");
  });
});

// ===========================================================================
// H4b: Proper YAML parser (not regex)
// ===========================================================================

describe("H4b #519: Gateway config uses proper YAML parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-h4b-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses config.yaml with proper YAML parser (values with colons work)", () => {
    const moduleDir = join(tmpDir, "discord");
    mkdirSync(moduleDir, { recursive: true });
    writeFileSync(join(moduleDir, ".env"), "DISCORD_BOT_TOKEN=tok\n");
    // Redmine URL contains a colon — the old regex parser would misparse this
    writeFileSync(join(moduleDir, "config.yaml"),
      "guild_id: '111222333444'\nredmine_url: 'http://redmine.example.com:8080'\n");

    const cfg = loadDaemonConfig(moduleDir);
    expect(cfg.guildId).toBe("111222333444");
    expect(cfg.redmineUrl).toBe("http://redmine.example.com:8080");
  });

  it("gateway-daemon.ts source imports parse from yaml package (H4b structural check)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../src/modules/discord/gateway-daemon.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("parseYaml");
    expect(src).toContain('from "yaml"');
    // Must NOT use the old regex match approach on YAML content
    expect(src).not.toMatch(/line\.match\(.*yaml/i);
  });
});

// ===========================================================================
// H4c: JSON injection — input validation for tool args
// ===========================================================================

import { beforeEach, afterEach } from "vitest";

describe("H4c #519: executeDiscordTool — JSON args validation", () => {
  it("throws on malformed JSON (not silent)", async () => {
    const client = makeClient();
    await expect(
      executeDiscordTool("discord_send_message", "{bad json}", client as never, BASE_CONFIG),
    ).rejects.toThrow(/malformed JSON/i);
  });

  it("throws when argsJson is a JSON array instead of object", async () => {
    const client = makeClient();
    await expect(
      executeDiscordTool("discord_send_message", '["ch1","msg"]', client as never, BASE_CONFIG),
    ).rejects.toThrow(/expected a JSON object/i);
  });

  it("throws on invalid action enum for manage_channel (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    await expect(
      executeDiscordTool(
        "discord_manage_channel",
        JSON.stringify({ action: "nuke", channel_id: "ch1" }),
        client as never, DESTRUCTIVE_CONFIG,
      ),
    ).rejects.toThrow(/invalid "action"/i);
  });

  it("throws on invalid action enum for manage_member (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    await expect(
      executeDiscordTool(
        "discord_manage_member",
        JSON.stringify({ action: "hack", guild_id: "g1", user_id: "u1" }),
        client as never, DESTRUCTIVE_CONFIG,
      ),
    ).rejects.toThrow(/invalid "action"/i);
  });

  it("throws when channel name exceeds 100 chars for create action", async () => {
    const client = makeClient();
    await expect(
      executeDiscordTool(
        "discord_manage_channel",
        JSON.stringify({ action: "create", guild_id: "g1", name: "x".repeat(101), type: "text" }),
        client as never, DESTRUCTIVE_CONFIG,
      ),
    ).rejects.toThrow(/too long/i);
  });

  it("throws when reason exceeds 512 chars for kick", async () => {
    const client = makeClient();
    await expect(
      executeDiscordTool(
        "discord_manage_member",
        JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1", reason: "r".repeat(513) }),
        client as never, DESTRUCTIVE_CONFIG,
      ),
    ).rejects.toThrow(/too long/i);
  });

  it("throws when required string field is missing (channel_id for send_message)", async () => {
    const client = makeClient();
    await expect(
      executeDiscordTool("discord_send_message", JSON.stringify({ content: "hello" }), client as never, BASE_CONFIG),
    ).rejects.toThrow(/channel_id/i);
  });
});
