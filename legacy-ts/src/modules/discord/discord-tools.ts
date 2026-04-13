// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Discord Module — Agent Tool Definitions + Executor
 *
 * 7 tools matching the PROMPT-374 spec:
 *   discord_send_message     — text or embed to any channel
 *   discord_read_messages    — read recent messages
 *   discord_create_thread    — create discussion thread
 *   discord_manage_channel   — create / edit / delete channel (unified)
 *   discord_manage_member    — add/remove role, kick, ban (unified)
 *   discord_server_status    — guild stats (members, channels, online)
 *   discord_post_dev_update  — structured commit-centric dev-log embed
 */

import type { DiscordClient }        from "./discord-client.js";
import type {
  DiscordModuleConfig,
  DevUpdateInput,
} from "./discord-types.js";


export const COLOR_FEATURE    = 0x5865F2; // Discord blurple  — features
export const COLOR_FIX        = 0xED4245; // Discord red       — bug fixes
export const COLOR_RELEASE    = 0x57F287; // Discord green     — releases
export const COLOR_DEPLOYMENT = 0xFEE75C; // Discord yellow    — deployments


type DevUpdateArgs = DevUpdateInput;


export interface ToolDefinition {
  name:        string;
  description: string;
  parameters:  {
    type:       "object";
    properties: Record<string, { type: string; description: string; enum?: string[]; items?: { type: string } }>;
    required?:  string[];
  };
}


export function getDiscordToolDefinitions(): ToolDefinition[] {
  return [
    {
      name:        "discord_send_message",
      description: "Send a message to a Discord channel. Supports plain text and rich embeds.",
      parameters: {
        type: "object",
        properties: {
          channel_id:        { type: "string", description: "Discord channel ID or name" },
          content:           { type: "string", description: "Plain text message content" },
          embed_title:       { type: "string", description: "Embed title (optional)" },
          embed_description: { type: "string", description: "Embed description (optional)" },
          embed_color:       { type: "number", description: "Embed hex color as integer (optional)" },
        },
        required: ["channel_id"],
      },
    },
    {
      name:        "discord_read_messages",
      description: "Read recent messages from a Discord channel.",
      parameters: {
        type: "object",
        properties: {
          channel_id: { type: "string", description: "Discord channel ID" },
          limit:      { type: "number", description: "Number of messages to retrieve (1-100, default 10)" },
        },
        required: ["channel_id"],
      },
    },
    {
      name:        "discord_create_thread",
      description: "Create a new discussion thread in a Discord channel.",
      parameters: {
        type: "object",
        properties: {
          channel_id:  { type: "string", description: "Parent channel ID" },
          name:        { type: "string", description: "Thread name" },
          message_id:  { type: "string", description: "Message to create thread from (optional)" },
        },
        required: ["channel_id", "name"],
      },
    },
    {
      name:        "discord_manage_channel",
      description: "Create, edit, or delete a Discord channel.",
      parameters: {
        type: "object",
        properties: {
          action:     { type: "string",  description: "Action to perform", enum: ["create", "edit", "delete"] },
          guild_id:   { type: "string",  description: "Guild ID (required for create)" },
          channel_id: { type: "string",  description: "Channel ID (required for edit/delete)" },
          name:       { type: "string",  description: "Channel name (required for create; optional for edit)" },
          type:       { type: "string",  description: "Channel type for create: text, voice, or category", enum: ["text", "voice", "category"] },
          topic:      { type: "string",  description: "Channel topic (for create/edit text channels)" },
          parent_id:  { type: "string",  description: "Parent category ID for create" },
        },
        required: ["action"],
      },
    },
    {
      name:        "discord_manage_member",
      description: "Manage a Discord server member: add/remove role, kick, or ban.",
      parameters: {
        type: "object",
        properties: {
          action:   { type: "string", description: "Action to perform", enum: ["add_role", "remove_role", "kick", "ban"] },
          guild_id: { type: "string", description: "Guild (server) ID" },
          user_id:  { type: "string", description: "User ID" },
          role_id:  { type: "string", description: "Role ID (required for add_role/remove_role)" },
          reason:   { type: "string", description: "Reason for kick/ban (shown in audit log)" },
        },
        required: ["action", "guild_id", "user_id"],
      },
    },
    {
      name:        "discord_server_status",
      description: "Get server (guild) statistics: member count, online count, channels.",
      parameters: {
        type: "object",
        properties: {
          guild_id: { type: "string", description: "Guild ID (uses default from config if omitted)" },
        },
      },
    },
    {
      name:        "discord_post_dev_update",
      description: "Post a structured development update embed to the configured dev-log channel.",
      parameters: {
        type: "object",
        properties: {
          commit_hash:    { type: "string", description: "Git commit hash (full or short)" },
          commit_message: { type: "string", description: "Git commit message (first line)" },
          test_count:     { type: "number", description: "Number of tests passing" },
          files_changed:  { type: "number", description: "Number of files changed" },
          summary:        { type: "string", description: "Human-readable summary of the change" },
          issue_ids:      { type: "array",  description: "Related issue numbers (optional)", items: { type: "number" } },
        },
        required: ["commit_hash", "commit_message", "test_count", "files_changed", "summary"],
      },
    },
  ];
}


/** Infer embed color from conventional commit keyword in message */
function inferDevUpdateColor(commitMessage: string): number {
  const lower = commitMessage.toLowerCase();
  if (/\bfix(es|ed)?\b/.test(lower) || lower.startsWith("fix:")) return COLOR_FIX;
  if (/\brelease\b/.test(lower) || /^v\d/.test(lower)) return COLOR_RELEASE;
  return COLOR_FEATURE;
}

export function formatDevUpdateEmbed(input: DevUpdateInput): Record<string, unknown> {
  const color  = inferDevUpdateColor(input.commit_message);
  const short  = input.commit_hash.slice(0, 7);

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Commit",        value: `\`${short}\``,                         inline: true },
    { name: "Tests",         value: `${input.test_count.toLocaleString()} passing`, inline: true },
    { name: "Files Changed", value: String(input.files_changed),             inline: true },
  ];

  if (input.issue_ids && input.issue_ids.length > 0) {
    fields.push({
      name:  "Issues",
      value: input.issue_ids.map((id) => `#${id}`).join(", "),
    });
  }

  return {
    title:       `📝 ${input.commit_message}`,
    description: input.summary,
    color,
    fields,
    footer:      { text: `commit ${short}` },
    timestamp:   new Date().toISOString(),
  };
}


const CHANNEL_TYPES: Record<string, number> = {
  text:     0,
  voice:    2,
  category: 4,
};


/**
 * Tools that perform irreversible or high-impact Discord operations.
 * Disabled by default — require `enableDestructiveOps: true` in module config.
 */
export const DESTRUCTIVE_TOOLS = new Set<string>([
  "discord_manage_channel",  // create / edit / delete channels
  "discord_manage_member",   // add/remove role, kick, ban
]);


/** Maximum nesting depth for parsed tool arguments — prevents stack exhaustion. */
const MAX_JSON_DEPTH = 10;

function _checkDepth(value: unknown, depth: number): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(`[discord-tools] Invalid tool arguments: JSON nesting exceeds ${MAX_JSON_DEPTH} levels`);
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      _checkDepth(v, depth + 1);
    }
  }
}

/** Parse argsJson as a plain JSON object. Throws descriptively on bad input. */
function parseArgs(argsJson: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch (e: unknown) {
    throw new Error(`[discord-tools] Invalid tool arguments: malformed JSON — ${String(e)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("[discord-tools] Invalid tool arguments: expected a JSON object, not array or primitive");
  }
  _checkDepth(parsed, 0);
  return parsed as Record<string, unknown>;
}

/** Extract a required non-empty string field. */
function str(obj: Record<string, unknown>, field: string): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`[discord-tools] Missing or invalid field "${field}": expected non-empty string`);
  }
  return v;
}

/** Extract an optional string field. */
function optStr(obj: Record<string, unknown>, field: string): string | undefined {
  const v = obj[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new Error(`[discord-tools] Invalid field "${field}": expected string`);
  }
  return v;
}

/** Validate a string enum field. */
function enumStr<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const v = str(obj, field);
  if (!(allowed as readonly string[]).includes(v)) {
    throw new Error(
      `[discord-tools] Invalid "${field}": must be one of [${allowed.join(", ")}], got "${v}"`,
    );
  }
  return v as T;
}

/** Extract an optional number, bounding it within [min, max]. */
function optBoundedNum(
  obj: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number | undefined {
  const v = obj[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !isFinite(v)) {
    throw new Error(`[discord-tools] Invalid field "${field}": expected a finite number`);
  }
  return Math.max(min, Math.min(max, Math.floor(v)));
}

/** Validate a channel name (max 100 chars). */
function channelNameStr(obj: Record<string, unknown>, field: string): string {
  const v = str(obj, field);
  if (v.length > 100) {
    throw new Error(
      `[discord-tools] "${field}" too long (max 100 chars): got ${v.length} chars`,
    );
  }
  return v;
}

/** Validate an optional reason string (max 512 chars). */
function optReasonStr(obj: Record<string, unknown>, field: string): string | undefined {
  const v = optStr(obj, field);
  if (v !== undefined && v.length > 512) {
    throw new Error(`[discord-tools] "${field}" too long (max 512 chars): got ${v.length} chars`);
  }
  return v;
}


export async function executeDiscordTool(
  toolName: string,
  argsJson: string,
  client: DiscordClient,
  config: DiscordModuleConfig,
): Promise<string> {
  // Block destructive tools unless explicitly enabled in module config.
  if (DESTRUCTIVE_TOOLS.has(toolName) && config.enableDestructiveOps !== true) {
    return JSON.stringify({
      ok:    false,
      error: `Discord tool "${toolName}" is disabled by default (destructive operation). ` +
             "Enable with enableDestructiveOps: true in module config.",
    });
  }

  // Parse and validate args as a plain JSON object before use.
  const args = parseArgs(argsJson);

  // P272 Task 5: Governance approval gate — second layer after the config gate.
  // When requireApprovalForDestructive is true, the agent must include a non-empty
  // "_approval_ref" in the args to prove the operation was governance-approved.
  if (DESTRUCTIVE_TOOLS.has(toolName) && config.requireApprovalForDestructive === true) {
    const approvalRef = typeof args["_approval_ref"] === "string" ? args["_approval_ref"].trim() : "";
    if (!approvalRef) {
      return JSON.stringify({
        ok:    false,
        error: `Discord tool "${toolName}" requires governance pre-approval. ` +
               "Include a non-empty \"_approval_ref\" field in tool arguments.",
      });
    }
  }

  switch (toolName) {
    // ── Send message ─────────────────────────────────────────────────────────
    case "discord_send_message": {
      const channelId   = str(args, "channel_id");
      const content     = optStr(args, "content");
      const embedTitle  = optStr(args, "embed_title");
      const embedDesc   = optStr(args, "embed_description");
      const embedColor  = optBoundedNum(args, "embed_color", 0, 0xFFFFFF);
      const payload: Record<string, unknown> = {};
      if (content) payload["content"] = content;
      if (embedTitle ?? embedDesc) {
        payload["embeds"] = [{ title: embedTitle, description: embedDesc, color: embedColor }];
      }
      const msg = await client.sendMessage(
        channelId,
        payload as Parameters<DiscordClient["sendMessage"]>[1],
      );
      return JSON.stringify({ ok: true, message_id: msg.id });
    }

    // ── Read messages ─────────────────────────────────────────────────────────
    case "discord_read_messages": {
      const channelId = str(args, "channel_id");
      const limit     = optBoundedNum(args, "limit", 1, 100) ?? 10;
      const msgs = await client.getMessages(channelId, { limit });
      const summary = msgs.map((m) => ({
        id:        m.id,
        author:    m.author.username,
        content:   m.content.slice(0, 200),
        timestamp: m.timestamp,
      }));
      return JSON.stringify({ ok: true, messages: summary });
    }

    // ── Create thread ─────────────────────────────────────────────────────────
    case "discord_create_thread": {
      const channelId = str(args, "channel_id");
      const name      = channelNameStr(args, "name");
      const messageId = optStr(args, "message_id");
      const threadParams: { name: string; message_id?: string } = { name };
      if (messageId !== undefined) threadParams.message_id = messageId;
      const thread = await client.createThread(channelId, threadParams);
      return JSON.stringify({ ok: true, thread_id: thread.id, name: thread.name });
    }

    // ── Manage channel (destructive — gated by destructive-tool check above) ──────────────
    case "discord_manage_channel": {
      const action = enumStr(args, "action", ["create", "edit", "delete"] as const);

      if (action === "create") {
        const guildId = optStr(args, "guild_id") ?? config.guild_id;
        if (!guildId) return JSON.stringify({ ok: false, error: "guild_id required for create" });
        const name        = channelNameStr(args, "name");
        const typeStr     = (optStr(args, "type") ?? "text") as "text" | "voice" | "category";
        const channelType = CHANNEL_TYPES[typeStr] ?? 0;
        const topic       = optStr(args, "topic");
        const parentId    = optStr(args, "parent_id");
        const params: Record<string, unknown> = { name, type: channelType };
        if (topic)    params["topic"]     = topic;
        if (parentId) params["parent_id"] = parentId;
        const ch = await client.createChannel(guildId, params as Parameters<DiscordClient["createChannel"]>[1]);
        return JSON.stringify({ ok: true, action: "create", channel_id: ch.id, name: ch.name });
      }

      if (action === "edit") {
        const channelId = str(args, "channel_id");
        const editParams: { name?: string; topic?: string } = {};
        const name  = optStr(args, "name");
        const topic = optStr(args, "topic");
        if (name)  editParams.name  = name;
        if (topic) editParams.topic = topic;
        const ch = await client.editChannel(channelId, editParams);
        return JSON.stringify({ ok: true, action: "edit", channel_id: ch.id });
      }

      // action === "delete"
      const channelId = str(args, "channel_id");
      await client.deleteChannel(channelId);
      return JSON.stringify({ ok: true, action: "delete", channel_id: channelId });
    }

    // ── Manage member (destructive — gated by destructive-tool check above) ───────────────
    case "discord_manage_member": {
      const action  = enumStr(args, "action", ["add_role", "remove_role", "kick", "ban"] as const);
      const guildId = str(args, "guild_id");
      const userId  = str(args, "user_id");

      if (action === "add_role") {
        const roleId = str(args, "role_id");
        await client.addRole(guildId, userId, roleId);
        return JSON.stringify({ ok: true, action: "add_role", user_id: userId, role_id: roleId });
      }

      if (action === "remove_role") {
        const roleId = str(args, "role_id");
        await client.removeRole(guildId, userId, roleId);
        return JSON.stringify({ ok: true, action: "remove_role", user_id: userId, role_id: roleId });
      }

      if (action === "kick") {
        const reason = optReasonStr(args, "reason");
        await client.kickMember(guildId, userId, reason);
        return JSON.stringify({ ok: true, action: "kick", user_id: userId });
      }

      // action === "ban"
      const reason = optReasonStr(args, "reason");
      await client.banMember(guildId, userId, reason);
      return JSON.stringify({ ok: true, action: "ban", user_id: userId });
    }

    // ── Server status ─────────────────────────────────────────────────────────
    case "discord_server_status": {
      const guildId = optStr(args, "guild_id") ?? config.guild_id;
      if (!guildId) return JSON.stringify({ ok: false, error: "guild_id not set — configure in module config or pass directly" });

      const [guild, channels] = await Promise.all([
        client.getGuild(guildId, true),
        client.listGuildChannels(guildId),
      ]);

      const status = {
        guild_id:      guild.id,
        guild_name:    guild.name,
        member_count:  guild.approximate_member_count ?? null,
        online_count:  guild.approximate_presence_count ?? null,
        channel_count: channels.length,
        channels:      channels.map((c) => ({ id: c.id, name: c.name ?? "", type: c.type })),
      };

      return JSON.stringify({ ok: true, ...status });
    }

    // ── Post dev update ───────────────────────────────────────────────────────
    case "discord_post_dev_update": {
      const issueIds = Array.isArray(args["issue_ids"])
        ? (args["issue_ids"] as unknown[]).filter((n): n is number => typeof n === "number")
        : undefined;
      const devArgs: DevUpdateArgs = {
        commit_hash:    str(args, "commit_hash"),
        commit_message: str(args, "commit_message"),
        test_count:     typeof args["test_count"] === "number" ? args["test_count"] : 0,
        files_changed:  typeof args["files_changed"] === "number" ? args["files_changed"] : 0,
        summary:        str(args, "summary"),
        ...(issueIds !== undefined ? { issue_ids: issueIds } : {}),
      };
      const embed = formatDevUpdateEmbed(devArgs);

      // Resolve channel: config.dev_log_channel (name) → ID, or fall back to default_channel_id
      const devLogChannelName = config.dev_log_channel ?? "dev-log";
      const guildId = config.guild_id;

      let channelId: string | undefined;
      if (guildId) {
        channelId = await client.resolveChannelId(guildId, devLogChannelName);
      }
      if (!channelId) channelId = config.default_channel_id;
      if (!channelId) return JSON.stringify({ ok: false, error: "Could not resolve dev_log_channel — check module config" });

      const msg = await client.sendMessage(channelId, {
        embeds: [embed as Parameters<DiscordClient["sendMessage"]>[1]["embeds"] extends (infer E)[] | undefined ? E : never],
      });
      return JSON.stringify({ ok: true, message_id: msg.id, channel_id: channelId });
    }

    default:
      return JSON.stringify({ ok: false, error: `Unknown tool: ${toolName}` });
  }
}
