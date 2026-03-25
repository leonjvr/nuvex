// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Discord Module — REST API Client
 *
 * Pure fetch()-based Discord API v10 client.  No discord.js, no WebSocket.
 * Injectable fetchFn for testability.
 *
 * Rate limit strategy: parse X-RateLimit-* headers; retry on 429 up to
 * MAX_RETRIES times with the server-specified `retry_after` delay.
 */

import type {
  DiscordMessage,
  DiscordChannel,
  DiscordGuildMember,
  DiscordGuild,
  DiscordThread,
  DiscordUser,
  DiscordEmbed,
  DiscordErrorBody,
} from "./discord-types.js";


import { createLogger } from "../../core/logger.js";

const logger = createLogger("discord-client");

export const DISCORD_API_BASE = "https://discord.com/api/v10";
const MAX_RETRIES = 3;


export class DiscordApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: DiscordErrorBody,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}


export class DiscordClient {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly token: string,
    opts?: { fetchFn?: typeof fetch },
  ) {
    this.fetchFn = opts?.fetchFn ?? fetch;
  }

  // ── Core request ──────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 0,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${DISCORD_API_BASE}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bot ${this.token}`,
      "User-Agent":    "SIDJUA (https://sidjua.com, v0.1.0)",
      ...extraHeaders,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const res = await this.fetchFn(url, init);

    // Rate limited — retry with server-specified delay
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? parseFloat(retryAfterHeader) : 1;
      const delayMs = Math.ceil(retryAfter * 1000);
      await sleep(delayMs);
      return this.request<T>(method, path, body, attempt + 1, extraHeaders);
    }

    if (!res.ok) {
      let errorBody: DiscordErrorBody = { code: 0, message: res.statusText };
      try {
        errorBody = await res.json() as DiscordErrorBody;
      } catch (e: unknown) {
        logger.debug("discord-client", "Discord error response body not JSON — using status text", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
      throw new DiscordApiError(
        `Discord API ${method} ${path} → ${res.status}: ${errorBody.message}`,
        res.status,
        errorBody,
      );
    }

    // 204 No Content — return undefined cast to T
    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  // ── Message operations ────────────────────────────────────────────────────

  async sendMessage(
    channelId: string,
    payload: { content?: string; embeds?: DiscordEmbed[] },
  ): Promise<DiscordMessage> {
    return this.request<DiscordMessage>("POST", `/channels/${channelId}/messages`, payload);
  }

  async editMessage(
    channelId: string,
    messageId: string,
    payload: { content?: string; embeds?: DiscordEmbed[] },
  ): Promise<DiscordMessage> {
    return this.request<DiscordMessage>("PATCH", `/channels/${channelId}/messages/${messageId}`, payload);
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    return this.request<void>("DELETE", `/channels/${channelId}/messages/${messageId}`);
  }

  async getMessages(
    channelId: string,
    params?: { limit?: number; before?: string; after?: string },
  ): Promise<DiscordMessage[]> {
    const qs = new URLSearchParams();
    if (params?.limit)  qs.set("limit",  String(params.limit));
    if (params?.before) qs.set("before", params.before);
    if (params?.after)  qs.set("after",  params.after);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return this.request<DiscordMessage[]>("GET", `/channels/${channelId}/messages${query}`);
  }

  // ── Thread operations ─────────────────────────────────────────────────────

  async createThread(
    channelId: string,
    params: {
      name:                   string;
      message_id?:            string;
      auto_archive_duration?: number;
    },
  ): Promise<DiscordThread> {
    if (params.message_id) {
      return this.request<DiscordThread>(
        "POST",
        `/channels/${channelId}/messages/${params.message_id}/threads`,
        { name: params.name, auto_archive_duration: params.auto_archive_duration ?? 1440 },
      );
    }
    return this.request<DiscordThread>(
      "POST",
      `/channels/${channelId}/threads`,
      {
        name:                   params.name,
        auto_archive_duration:  params.auto_archive_duration ?? 1440,
        type:                   11, // GUILD_PUBLIC_THREAD
      },
    );
  }

  // ── Channel operations ────────────────────────────────────────────────────

  async getChannel(channelId: string): Promise<DiscordChannel> {
    return this.request<DiscordChannel>("GET", `/channels/${channelId}`);
  }

  async listGuildChannels(guildId: string): Promise<DiscordChannel[]> {
    return this.request<DiscordChannel[]>("GET", `/guilds/${guildId}/channels`);
  }

  async createChannel(
    guildId: string,
    params: { name: string; type?: number; topic?: string; parent_id?: string },
  ): Promise<DiscordChannel> {
    return this.request<DiscordChannel>("POST", `/guilds/${guildId}/channels`, params);
  }

  async editChannel(
    channelId: string,
    params: { name?: string; topic?: string },
  ): Promise<DiscordChannel> {
    return this.request<DiscordChannel>("PATCH", `/channels/${channelId}`, params);
  }

  async deleteChannel(channelId: string): Promise<DiscordChannel> {
    return this.request<DiscordChannel>("DELETE", `/channels/${channelId}`);
  }

  // ── Member / role operations ──────────────────────────────────────────────

  async getGuildMember(guildId: string, userId: string): Promise<DiscordGuildMember> {
    return this.request<DiscordGuildMember>("GET", `/guilds/${guildId}/members/${userId}`);
  }

  async listGuildMembers(guildId: string, limit = 100): Promise<DiscordGuildMember[]> {
    return this.request<DiscordGuildMember[]>(
      "GET",
      `/guilds/${guildId}/members?limit=${limit}`,
    );
  }

  async addRole(guildId: string, userId: string, roleId: string): Promise<void> {
    return this.request<void>("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  async removeRole(guildId: string, userId: string, roleId: string): Promise<void> {
    return this.request<void>("DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  }

  async kickMember(guildId: string, userId: string, reason?: string): Promise<void> {
    const path = `/guilds/${guildId}/members/${userId}`;
    const headers: Record<string, string> = {};
    if (reason) headers["X-Audit-Log-Reason"] = reason;
    return this.request<void>("DELETE", path, undefined, 0, headers);
  }

  async banMember(guildId: string, userId: string, reason?: string): Promise<void> {
    const path = `/guilds/${guildId}/bans/${userId}`;
    const body: Record<string, string> = {};
    if (reason) body["reason"] = reason;
    return this.request<void>("PUT", path, Object.keys(body).length ? body : undefined);
  }

  // ── Guild operations ──────────────────────────────────────────────────────

  /** @param withCounts — include approximate_member_count + approximate_presence_count */
  async getGuild(guildId: string, withCounts = false): Promise<DiscordGuild> {
    const qs = withCounts ? "?with_counts=true" : "";
    return this.request<DiscordGuild>("GET", `/guilds/${guildId}${qs}`);
  }

  // ── Self ──────────────────────────────────────────────────────────────────

  async getCurrentUser(): Promise<DiscordUser> {
    return this.request<DiscordUser>("GET", "/users/@me");
  }

  // ── Reactions ─────────────────────────────────────────────────────────────

  /**
   * Add a reaction to a message.
   * Emoji can be a Unicode character (e.g. "✅") or custom emoji in `name:id` format.
   */
  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const encoded = encodeURIComponent(emoji);
    return this.request<void>(
      "PUT",
      `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
    );
  }

  /**
   * Resolve a channel by name within a guild.
   * Returns the first channel matching the name (case-insensitive).
   */
  async resolveChannelId(guildId: string, nameOrId: string): Promise<string | undefined> {
    // If it looks like a snowflake ID, use directly
    if (/^\d{17,20}$/.test(nameOrId)) return nameOrId;

    const channels = await this.listGuildChannels(guildId);
    const match = channels.find(
      (c) => c.name?.toLowerCase() === nameOrId.toLowerCase(),
    );
    return match?.id;
  }
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
