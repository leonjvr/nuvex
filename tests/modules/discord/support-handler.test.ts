// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SupportHandler,
  detectPriority,
} from "../../../src/modules/discord/handlers/support-handler.js";
import { DocMatcher }    from "../../../src/modules/discord/handlers/doc-matcher.js";
import { RedmineHandler } from "../../../src/modules/discord/handlers/redmine-handler.js";
import type { GatewayMessage } from "../../../src/modules/discord/discord-types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<GatewayMessage> = {}): GatewayMessage {
  return {
    id:          "msg1",
    channel_id:  "ch-support",
    guild_id:    "g1",
    author:      { id: "user1", username: "Alice" },
    content:     "hello world",
    timestamp:   "2026-01-01T00:00:00Z",
    attachments: [],
    embeds:      [],
    ...overrides,
  };
}

function makeClient(): {
  sendMessage:  ReturnType<typeof vi.fn>;
  addReaction:  ReturnType<typeof vi.fn>;
} {
  return {
    sendMessage: vi.fn().mockResolvedValue({ id: "reply1" }),
    addReaction: vi.fn().mockResolvedValue(undefined),
  };
}

// Empty doc matcher — no docs loaded
const emptyMatcher = new DocMatcher([]);

// Doc matcher with a matching entry for "crash" keyword
const crashDoc = new DocMatcher([{
  filename: "TROUBLESHOOTING.md",
  content: "## Application Crash\n\nIf the app crashes on startup check the config file.\n",
}]);

// ---------------------------------------------------------------------------
// Priority detection tests
// ---------------------------------------------------------------------------

describe("detectPriority", () => {
  it("returns HIGH for crash keywords", () => {
    expect(detectPriority("My app crashed and I lost all data")).toBe("HIGH");
    expect(detectPriority("Critical security vulnerability found")).toBe("HIGH");
    expect(detectPriority("Stack trace: Error at line 42")).toBe("HIGH");
  });

  it("returns NORMAL for bug/help keywords", () => {
    expect(detectPriority("I found a bug in the routing")).toBe("NORMAL");
    expect(detectPriority("How to configure sidjua apply?")).toBe("NORMAL");
    expect(detectPriority("I am confused and stuck on this")).toBe("NORMAL");
  });

  it("returns LOW for suggestion/question keywords", () => {
    expect(detectPriority("Suggestion: would be nice to have dark mode")).toBe("LOW");
    expect(detectPriority("Feature request: add export to CSV")).toBe("LOW");
  });
});

// ---------------------------------------------------------------------------
// SupportHandler tests
// ---------------------------------------------------------------------------

describe("SupportHandler", () => {
  const CHANNEL_IDS = new Set(["ch-support", "ch-bugs"]);
  const BOT_ID      = "bot999";

  describe("message filtering", () => {
    it("ignores messages from bots", async () => {
      const client  = makeClient();
      const handler = new SupportHandler(
        client as never,
        emptyMatcher,
        null,
        { supportChannelIds: CHANNEL_IDS, botUserId: BOT_ID },
      );

      const botMsg = makeMessage({ author: { id: "other-bot", username: "OtherBot", bot: true } });
      await handler.handleMessage(botMsg);

      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(client.addReaction).not.toHaveBeenCalled();
    });

    it("ignores messages outside configured support channels", async () => {
      const client  = makeClient();
      const handler = new SupportHandler(
        client as never,
        emptyMatcher,
        null,
        { supportChannelIds: CHANNEL_IDS, botUserId: BOT_ID },
      );

      const wrongChannel = makeMessage({ channel_id: "ch-random" });
      await handler.handleMessage(wrongChannel);

      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(client.addReaction).not.toHaveBeenCalled();
    });

    it("ignores DMs (messages without guild_id)", async () => {
      const client  = makeClient();
      const handler = new SupportHandler(
        client as never,
        emptyMatcher,
        null,
        { supportChannelIds: CHANNEL_IDS, botUserId: BOT_ID },
      );

      const dm = makeMessage({ guild_id: undefined });
      await handler.handleMessage(dm);

      expect(client.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("message handling", () => {
    it("reacts with 🔍 when no doc match and not high priority", async () => {
      const client  = makeClient();
      const handler = new SupportHandler(
        client as never,
        emptyMatcher,
        null,
        { supportChannelIds: CHANNEL_IDS, botUserId: BOT_ID },
      );

      const msg = makeMessage({ content: "wondering how this works" });
      await handler.handleMessage(msg);

      expect(client.addReaction).toHaveBeenCalledWith("ch-support", "msg1", "🔍");
    });

    it("replies with doc match embed and reacts with ✅", async () => {
      const client  = makeClient();
      const handler = new SupportHandler(
        client as never,
        crashDoc,
        null,
        { supportChannelIds: CHANNEL_IDS, botUserId: BOT_ID },
      );

      const msg = makeMessage({ content: "application crash on startup" });
      await handler.handleMessage(msg);

      expect(client.sendMessage).toHaveBeenCalledWith(
        "ch-support",
        expect.objectContaining({ embeds: expect.arrayContaining([expect.objectContaining({ title: "Application Crash" })]) }),
      );
      expect(client.addReaction).toHaveBeenCalledWith("ch-support", "msg1", "✅");
    });

    it("creates Redmine issue and reacts with 🎫 for HIGH priority", async () => {
      const client          = makeClient();
      const mockRedmine     = {
        canCreateIssue: vi.fn().mockReturnValue(true),
        createIssue:    vi.fn().mockResolvedValue(42),
      };

      const handler = new SupportHandler(
        client as never,
        emptyMatcher,
        mockRedmine as unknown as RedmineHandler,
        { supportChannelIds: CHANNEL_IDS, botUserId: BOT_ID },
      );

      const msg = makeMessage({ content: "CRITICAL: the app crashed and won't start" });
      await handler.handleMessage(msg);

      expect(mockRedmine.createIssue).toHaveBeenCalled();
      expect(client.sendMessage).toHaveBeenCalledWith(
        "ch-support",
        expect.objectContaining({ content: expect.stringContaining("#42") }),
      );
      expect(client.addReaction).toHaveBeenCalledWith("ch-support", "msg1", "🎫");
    });
  });
});
