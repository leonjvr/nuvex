// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedmineHandler } from "../../../src/modules/discord/handlers/redmine-handler.js";
import type { GatewayMessage } from "../../../src/modules/discord/discord-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<GatewayMessage> = {}): GatewayMessage {
  return {
    id:          "msg1",
    channel_id:  "ch-support",
    guild_id:    "g1",
    author:      { id: "user1", username: "Alice" },
    content:     "Something is broken",
    timestamp:   "2026-01-01T00:00:00Z",
    attachments: [],
    embeds:      [],
    ...overrides,
  };
}

function makeRedmineFetch(issueId: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ issue: { id: issueId, subject: "test" } }),
  }) as unknown as typeof fetch;
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

const CONFIG = { apiKey: "redmine-key-abc", baseUrl: "http://redmine.local:8080" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RedmineHandler", () => {
  it("creates issue with correct Redmine fields for HIGH priority", async () => {
    const fetchFn = makeRedmineFetch(99);
    const handler = new RedmineHandler(CONFIG, makeClient() as never, { fetchFn });

    const msg = makeMessage({ content: "App crashed and data is lost" });
    const issueId = await handler.createIssue(msg, "HIGH", "ch-support");

    expect(issueId).toBe(99);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://redmine.local:8080/issues.json",
      expect.objectContaining({
        method:  "POST",
        headers: expect.objectContaining({
          "X-Redmine-API-Key": "redmine-key-abc",
          "Content-Type":      "application/json",
        }),
      }),
    );

    const call     = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body     = JSON.parse(call[1].body as string) as { issue: { priority_id: number; assigned_to_id: number; tracker_id: number } };
    expect(body.issue.priority_id).toBe(3);     // Urgent
    expect(body.issue.assigned_to_id).toBe(7);  // Haiku
    expect(body.issue.tracker_id).toBe(1);      // Bug
  });

  it("truncates subject to [BUG] + first 80 chars of content", async () => {
    const fetchFn = makeRedmineFetch(100);
    const handler = new RedmineHandler(CONFIG, makeClient() as never, { fetchFn });

    const longContent = "x".repeat(200);
    const msg = makeMessage({ content: longContent });
    await handler.createIssue(msg, "NORMAL", "ch-bugs");

    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as { issue: { subject: string } };

    // Subject is "[BUG] " + first 80 chars = 6 + 80 = 86 chars
    expect(body.issue.subject).toBe(`[BUG] ${"x".repeat(80)}`);
    expect(body.issue.subject.length).toBe(86);
  });

  it("rate-limits to max 5 issues per user per hour", async () => {
    const fetchFn = makeRedmineFetch(1);
    const handler = new RedmineHandler(CONFIG, makeClient() as never, { fetchFn });

    const msg = makeMessage({ author: { id: "spammer", username: "Spammer" } });

    // First 5 should succeed
    for (let i = 0; i < 5; i++) {
      expect(handler.canCreateIssue("spammer")).toBe(true);
      await handler.createIssue(msg, "HIGH", "ch-support");
    }

    // 6th should be blocked
    expect(handler.canCreateIssue("spammer")).toBe(false);
  });

  it("different users have independent rate limits", async () => {
    const fetchFn = makeRedmineFetch(1);
    const handler = new RedmineHandler(CONFIG, makeClient() as never, { fetchFn });

    const msgA = makeMessage({ author: { id: "userA", username: "UserA" } });
    const msgB = makeMessage({ author: { id: "userB", username: "UserB" } });

    // Fill up userA's quota
    for (let i = 0; i < 5; i++) {
      await handler.createIssue(msgA, "HIGH", "ch-support");
    }

    expect(handler.canCreateIssue("userA")).toBe(false);
    expect(handler.canCreateIssue("userB")).toBe(true); // userB unaffected
  });
});
