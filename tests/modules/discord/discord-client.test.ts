// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordClient, DiscordApiError, DISCORD_API_BASE } from "../../../src/modules/discord/discord-client.js";

// ---------------------------------------------------------------------------
// Mock fetch factory
// ---------------------------------------------------------------------------

function makeFetch(responses: Array<{
  status:  number;
  body?:   unknown;
  headers?: Record<string, string>;
}>) {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    const spec = responses[callCount++] ?? responses[responses.length - 1]!;
    const body = spec.body !== undefined ? JSON.stringify(spec.body) : "";
    const headers = new Headers(spec.headers ?? {});

    return {
      ok:      spec.status >= 200 && spec.status < 300,
      status:  spec.status,
      headers,
      json:    async () => JSON.parse(body) as unknown,
      text:    async () => body,
    } as unknown as Response;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DiscordClient", () => {
  describe("sendMessage", () => {
    it("sends POST to /channels/:id/messages", async () => {
      const fetchFn = makeFetch([{ status: 200, body: { id: "msg1", content: "hi", author: { id: "u1", username: "bot", discriminator: "0", global_name: null }, channel_id: "ch1", timestamp: "2026-01-01T00:00:00.000Z", embeds: [] } }]);
      const client = new DiscordClient("tok", { fetchFn });

      const msg = await client.sendMessage("ch1", { content: "hi" });
      expect(msg.id).toBe("msg1");

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${DISCORD_API_BASE}/channels/ch1/messages`);
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ Authorization: "Bot tok" });
    });

    it("throws DiscordApiError on 403", async () => {
      const fetchFn = makeFetch([{ status: 403, body: { code: 50013, message: "Missing Permissions" } }]);
      const client = new DiscordClient("tok", { fetchFn });

      await expect(client.sendMessage("ch1", { content: "hi" })).rejects.toThrow(DiscordApiError);
      await expect(client.sendMessage("ch1", { content: "hi" })).rejects.toMatchObject({
        status: 403,
        body:   { code: 50013 },
      });
    });

    it("retries on 429 with retry-after delay", async () => {
      vi.useFakeTimers();

      const fetchFn = makeFetch([
        { status: 429, body: { message: "rate limited" }, headers: { "retry-after": "0.001" } },
        { status: 200, body: { id: "msg2", content: "hi", author: { id: "u1", username: "bot", discriminator: "0", global_name: null }, channel_id: "ch1", timestamp: "", embeds: [] } },
      ]);
      const client = new DiscordClient("tok", { fetchFn });

      const promise = client.sendMessage("ch1", { content: "hi" });
      await vi.runAllTimersAsync();
      const msg = await promise;
      expect(msg.id).toBe("msg2");
      expect(fetchFn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe("getMessages", () => {
    it("sends GET with query params", async () => {
      const fetchFn = makeFetch([{ status: 200, body: [] }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.getMessages("ch1", { limit: 5, before: "999" });

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toContain("limit=5");
      expect(url).toContain("before=999");
    });

    it("omits query params when not specified", async () => {
      const fetchFn = makeFetch([{ status: 200, body: [] }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.getMessages("ch1");

      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toBe(`${DISCORD_API_BASE}/channels/ch1/messages`);
    });
  });

  describe("deleteMessage", () => {
    it("sends DELETE and handles 204 response", async () => {
      const fetchFn = makeFetch([{ status: 204 }]);
      const client = new DiscordClient("tok", { fetchFn });

      await expect(client.deleteMessage("ch1", "msg1")).resolves.toBeUndefined();
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/messages/msg1");
      expect(init.method).toBe("DELETE");
    });
  });

  describe("getCurrentUser", () => {
    it("sends GET /users/@me", async () => {
      const fetchFn = makeFetch([{ status: 200, body: { id: "1", username: "bot", discriminator: "0", global_name: null } }]);
      const client = new DiscordClient("tok", { fetchFn });

      const user = await client.getCurrentUser();
      expect(user.username).toBe("bot");
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toContain("/users/@me");
    });
  });

  describe("manageRoles", () => {
    it("addRole sends PUT", async () => {
      const fetchFn = makeFetch([{ status: 204 }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.addRole("g1", "u1", "r1");
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/members/u1/roles/r1");
      expect(init.method).toBe("PUT");
    });

    it("removeRole sends DELETE", async () => {
      const fetchFn = makeFetch([{ status: 204 }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.removeRole("g1", "u1", "r1");
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("DELETE");
    });
  });

  describe("kickMember", () => {
    it("sends DELETE to /guilds/{id}/members/{userId}", async () => {
      const fetchFn = makeFetch([{ status: 204 }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.kickMember("g1", "u1");
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/guilds/g1/members/u1");
      expect(init.method).toBe("DELETE");
    });

    it("sets X-Audit-Log-Reason header when reason provided", async () => {
      const fetchFn = makeFetch([{ status: 204 }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.kickMember("g1", "u1", "spamming");
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["X-Audit-Log-Reason"]).toBe("spamming");
    });
  });

  describe("banMember", () => {
    it("sends PUT to /guilds/{id}/bans/{userId}", async () => {
      const fetchFn = makeFetch([{ status: 204 }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.banMember("g1", "u1");
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/guilds/g1/bans/u1");
      expect(init.method).toBe("PUT");
    });
  });

  describe("getGuild with_counts", () => {
    it("appends ?with_counts=true when requested", async () => {
      const fetchFn = makeFetch([{ status: 200, body: { id: "g1", name: "Test", icon: null } }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.getGuild("g1", true);
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).toContain("with_counts=true");
    });

    it("does not append with_counts by default", async () => {
      const fetchFn = makeFetch([{ status: 200, body: { id: "g1", name: "Test", icon: null } }]);
      const client = new DiscordClient("tok", { fetchFn });

      await client.getGuild("g1");
      const [url] = fetchFn.mock.calls[0] as [string];
      expect(url).not.toContain("with_counts");
    });
  });

  describe("resolveChannelId", () => {
    it("returns snowflake as-is if already an ID", async () => {
      const fetchFn = makeFetch([]);
      const client = new DiscordClient("tok", { fetchFn });

      const result = await client.resolveChannelId("g1", "123456789012345678");
      expect(result).toBe("123456789012345678");
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it("looks up channel by name (case-insensitive)", async () => {
      const channels = [
        { id: "ch_dev", name: "dev-updates", type: 0 },
        { id: "ch_gen", name: "general",     type: 0 },
      ];
      const fetchFn = makeFetch([{ status: 200, body: channels }]);
      const client = new DiscordClient("tok", { fetchFn });

      const result = await client.resolveChannelId("g1", "Dev-Updates");
      expect(result).toBe("ch_dev");
    });

    it("returns undefined for unrecognized name", async () => {
      const fetchFn = makeFetch([{ status: 200, body: [] }]);
      const client = new DiscordClient("tok", { fetchFn });

      const result = await client.resolveChannelId("g1", "nonexistent");
      expect(result).toBeUndefined();
    });
  });
});
