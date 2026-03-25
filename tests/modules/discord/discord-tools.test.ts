// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import {
  getDiscordToolDefinitions,
  formatDevUpdateEmbed,
  executeDiscordTool,
  COLOR_FEATURE,
  COLOR_FIX,
  COLOR_RELEASE,
} from "../../../src/modules/discord/discord-tools.js";
import type { DiscordModuleConfig } from "../../../src/modules/discord/discord-types.js";

// ---------------------------------------------------------------------------
// Minimal mock DiscordClient
// ---------------------------------------------------------------------------

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    sendMessage:         vi.fn().mockResolvedValue({ id: "msg1" }),
    editMessage:         vi.fn().mockResolvedValue({ id: "msg1" }),
    deleteMessage:       vi.fn().mockResolvedValue(undefined),
    getMessages:         vi.fn().mockResolvedValue([
      { id: "m1", content: "hello", author: { username: "Alice" }, timestamp: "2026-01-01T00:00:00Z" },
    ]),
    createThread:        vi.fn().mockResolvedValue({ id: "t1", name: "my-thread" }),
    createChannel:       vi.fn().mockResolvedValue({ id: "ch_new", name: "general" }),
    editChannel:         vi.fn().mockResolvedValue({ id: "ch1", name: "general" }),
    deleteChannel:       vi.fn().mockResolvedValue({ id: "ch1" }),
    addRole:             vi.fn().mockResolvedValue(undefined),
    removeRole:          vi.fn().mockResolvedValue(undefined),
    kickMember:          vi.fn().mockResolvedValue(undefined),
    banMember:           vi.fn().mockResolvedValue(undefined),
    getGuild:            vi.fn().mockResolvedValue({ id: "g1", name: "SIDJUA Community", icon: null, approximate_member_count: 42, approximate_presence_count: 10 }),
    listGuildChannels:   vi.fn().mockResolvedValue([
      { id: "ch1", name: "general",     type: 0 },
      { id: "ch2", name: "dev-log",     type: 0 },
      { id: "ch3", name: "voice-chat",  type: 2 },
    ]),
    resolveChannelId:    vi.fn().mockResolvedValue("ch2"),
    ...overrides,
  };
}

const CONFIG: DiscordModuleConfig = {
  bot_token:             "tok",
  guild_id:              "g1",
  dev_log_channel:       "dev-log",
  announcements_channel: "announcements",
};

/** Config with destructive ops unlocked — for tests that explicitly exercise manage_channel/manage_member */
const CONFIG_DESTRUCTIVE: DiscordModuleConfig = { ...CONFIG, enableDestructiveOps: true };

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe("getDiscordToolDefinitions", () => {
  it("returns 7 tools", () => {
    const tools = getDiscordToolDefinitions();
    expect(tools).toHaveLength(7);
  });

  it("contains exactly the spec-required tool names", () => {
    const names = getDiscordToolDefinitions().map((t) => t.name).sort();
    expect(names).toEqual([
      "discord_create_thread",
      "discord_manage_channel",
      "discord_manage_member",
      "discord_post_dev_update",
      "discord_read_messages",
      "discord_send_message",
      "discord_server_status",
    ]);
  });

  it("each tool has name, description, object parameters", () => {
    for (const tool of getDiscordToolDefinitions()) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("discord_manage_channel has action enum [create, edit, delete]", () => {
    const t = getDiscordToolDefinitions().find((t) => t.name === "discord_manage_channel")!;
    expect(t.parameters.properties["action"]?.enum).toEqual(["create", "edit", "delete"]);
  });

  it("discord_manage_member has action enum [add_role, remove_role, kick, ban]", () => {
    const t = getDiscordToolDefinitions().find((t) => t.name === "discord_manage_member")!;
    expect(t.parameters.properties["action"]?.enum).toEqual(["add_role", "remove_role", "kick", "ban"]);
  });

  it("discord_post_dev_update requires commit_hash, commit_message, test_count, files_changed, summary", () => {
    const t = getDiscordToolDefinitions().find((t) => t.name === "discord_post_dev_update")!;
    expect(t.parameters.required).toEqual(expect.arrayContaining([
      "commit_hash", "commit_message", "test_count", "files_changed", "summary",
    ]));
  });
});

// ---------------------------------------------------------------------------
// formatDevUpdateEmbed
// ---------------------------------------------------------------------------

describe("formatDevUpdateEmbed", () => {
  it("uses COLOR_FIX for commit messages with 'fix'", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc1234", commit_message: "fix: resolve crash", test_count: 100, files_changed: 3, summary: "Fixes crash on startup" });
    expect(embed.color).toBe(COLOR_FIX);
  });

  it("uses COLOR_RELEASE for commit messages with 'release'", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc1234", commit_message: "release v1.0", test_count: 100, files_changed: 0, summary: "Release" });
    expect(embed.color).toBe(COLOR_RELEASE);
  });

  it("defaults to COLOR_FEATURE for other messages", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc1234", commit_message: "feat: add search", test_count: 100, files_changed: 5, summary: "New search" });
    expect(embed.color).toBe(COLOR_FEATURE);
  });

  it("includes short commit hash (7 chars) in a Commit field", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc1234567890", commit_message: "feat: x", test_count: 50, files_changed: 2, summary: "s" });
    const fields = embed.fields as Array<{ name: string; value: string }>;
    const commitField = fields.find((f) => f.name === "Commit");
    expect(commitField?.value).toContain("abc1234");
    expect(commitField?.value).not.toContain("567890"); // truncated at 7
  });

  it("includes test_count in a Tests field", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc1234", commit_message: "feat: x", test_count: 2463, files_changed: 5, summary: "s" });
    const fields = embed.fields as Array<{ name: string; value: string }>;
    const testsField = fields.find((f) => f.name === "Tests");
    expect(testsField?.value).toContain("2,463");
  });

  it("includes files_changed in a Files Changed field", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc1234", commit_message: "feat: x", test_count: 100, files_changed: 15, summary: "s" });
    const fields = embed.fields as Array<{ name: string; value: string }>;
    const filesField = fields.find((f) => f.name === "Files Changed");
    expect(filesField?.value).toBe("15");
  });

  it("includes issue_ids when provided", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc", commit_message: "fix: crash", test_count: 10, files_changed: 1, summary: "s", issue_ids: [42, 43] });
    const fields = embed.fields as Array<{ name: string; value: string }>;
    const issuesField = fields.find((f) => f.name === "Issues");
    expect(issuesField?.value).toContain("#42");
    expect(issuesField?.value).toContain("#43");
  });

  it("omits Issues field when issue_ids not provided", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc", commit_message: "feat: x", test_count: 10, files_changed: 1, summary: "s" });
    const fields = embed.fields as Array<{ name: string; value: string }>;
    const issuesField = fields.find((f) => f.name === "Issues");
    expect(issuesField).toBeUndefined();
  });

  it("sets description to summary", () => {
    const embed = formatDevUpdateEmbed({ commit_hash: "abc", commit_message: "feat: x", test_count: 10, files_changed: 1, summary: "My summary text" });
    expect(embed.description).toBe("My summary text");
  });
});

// ---------------------------------------------------------------------------
// executeDiscordTool
// ---------------------------------------------------------------------------

describe("executeDiscordTool", () => {
  it("discord_send_message — calls client.sendMessage", async () => {
    const client = makeClient();
    const result = await executeDiscordTool("discord_send_message", JSON.stringify({ channel_id: "ch1", content: "hello" }), client as never, CONFIG);
    const parsed = JSON.parse(result) as { ok: boolean; message_id: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.message_id).toBe("msg1");
    expect(client.sendMessage).toHaveBeenCalledWith("ch1", expect.objectContaining({ content: "hello" }));
  });

  it("discord_read_messages — returns message summary", async () => {
    const client = makeClient();
    const result = await executeDiscordTool("discord_read_messages", JSON.stringify({ channel_id: "ch1", limit: 5 }), client as never, CONFIG);
    const parsed = JSON.parse(result) as { ok: boolean; messages: Array<{ author: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.messages[0]?.author).toBe("Alice");
    expect(client.getMessages).toHaveBeenCalledWith("ch1", { limit: 5 });
  });

  it("discord_create_thread — calls client.createThread", async () => {
    const client = makeClient();
    const result = await executeDiscordTool("discord_create_thread", JSON.stringify({ channel_id: "ch1", name: "my-thread" }), client as never, CONFIG);
    const parsed = JSON.parse(result) as { ok: boolean; thread_id: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.thread_id).toBe("t1");
  });

  it("discord_manage_channel create — calls createChannel (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_channel",
      JSON.stringify({ action: "create", guild_id: "g1", name: "announcements", type: "text" }),
      client as never, CONFIG_DESTRUCTIVE,
    );
    const parsed = JSON.parse(result) as { ok: boolean; action: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("create");
    expect(client.createChannel).toHaveBeenCalledWith("g1", expect.objectContaining({ name: "announcements" }));
  });

  it("discord_manage_channel edit — calls editChannel (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_channel",
      JSON.stringify({ action: "edit", channel_id: "ch1", topic: "New topic" }),
      client as never, CONFIG_DESTRUCTIVE,
    );
    const parsed = JSON.parse(result) as { ok: boolean; action: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("edit");
    expect(client.editChannel).toHaveBeenCalledWith("ch1", { topic: "New topic" });
  });

  it("discord_manage_channel delete — calls deleteChannel (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_channel",
      JSON.stringify({ action: "delete", channel_id: "ch1" }),
      client as never, CONFIG_DESTRUCTIVE,
    );
    const parsed = JSON.parse(result) as { ok: boolean; action: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("delete");
    expect(client.deleteChannel).toHaveBeenCalledWith("ch1");
  });

  it("discord_manage_member add_role — calls addRole (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "add_role", guild_id: "g1", user_id: "u1", role_id: "r1" }),
      client as never, CONFIG_DESTRUCTIVE,
    );
    const parsed = JSON.parse(result) as { ok: boolean; action: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("add_role");
    expect(client.addRole).toHaveBeenCalledWith("g1", "u1", "r1");
  });

  it("discord_manage_member remove_role — calls removeRole (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "remove_role", guild_id: "g1", user_id: "u1", role_id: "r1" }),
      client as never, CONFIG_DESTRUCTIVE,
    );
    expect(client.removeRole).toHaveBeenCalledWith("g1", "u1", "r1");
  });

  it("discord_manage_member kick — calls kickMember (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1", reason: "spam" }),
      client as never, CONFIG_DESTRUCTIVE,
    );
    const parsed = JSON.parse(result) as { ok: boolean; action: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("kick");
    expect(client.kickMember).toHaveBeenCalledWith("g1", "u1", "spam");
  });

  it("discord_manage_member ban — calls banMember (enableDestructiveOps=true)", async () => {
    const client = makeClient();
    await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "ban", guild_id: "g1", user_id: "u1" }),
      client as never, CONFIG_DESTRUCTIVE,
    );
    expect(client.banMember).toHaveBeenCalledWith("g1", "u1", undefined);
  });

  it("discord_server_status — aggregates guild info", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_server_status",
      JSON.stringify({}),
      client as never, CONFIG,
    );
    const parsed = JSON.parse(result) as { ok: boolean; guild_name: string; member_count: number; channel_count: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.guild_name).toBe("SIDJUA Community");
    expect(parsed.member_count).toBe(42);
    expect(parsed.channel_count).toBe(3);
  });

  it("discord_server_status — uses config guild_id when not in args", async () => {
    const client = makeClient();
    await executeDiscordTool("discord_server_status", JSON.stringify({}), client as never, CONFIG);
    expect(client.getGuild).toHaveBeenCalledWith("g1", true);
  });

  it("discord_server_status — returns error when no guild_id configured", async () => {
    const client = makeClient();
    const configNoGuild: DiscordModuleConfig = { bot_token: "tok" };
    const result = await executeDiscordTool("discord_server_status", JSON.stringify({}), client as never, configNoGuild);
    const parsed = JSON.parse(result) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("guild_id");
  });

  it("discord_post_dev_update — resolves dev_log_channel and posts embed", async () => {
    const client = makeClient();
    const result = await executeDiscordTool(
      "discord_post_dev_update",
      JSON.stringify({ commit_hash: "abc1234", commit_message: "feat: search", test_count: 2463, files_changed: 15, summary: "Added search" }),
      client as never, CONFIG,
    );
    const parsed = JSON.parse(result) as { ok: boolean; channel_id: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.channel_id).toBe("ch2"); // resolveChannelId mock returns "ch2"
    expect(client.sendMessage).toHaveBeenCalledWith("ch2", expect.objectContaining({ embeds: expect.anything() }));
  });

  it("returns error for unknown tool name", async () => {
    const client = makeClient();
    const result = await executeDiscordTool("discord_nonexistent", JSON.stringify({}), client as never, CONFIG);
    const parsed = JSON.parse(result) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("Unknown tool");
  });
});
