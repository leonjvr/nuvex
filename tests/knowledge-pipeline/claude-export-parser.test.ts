// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for ClaudeExportParser — V0.9.3
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { ClaudeExportParser } from "../../src/knowledge-pipeline/parsers/claude-export-parser.js";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "conv-001",
    name: "Test Conversation",
    created_at: "2026-01-15T10:30:00.000Z",
    chat_messages: [
      { uuid: "msg-1", sender: "human", text: "Hello there", created_at: "2026-01-15T10:30:00Z" },
      { uuid: "msg-2", sender: "assistant", text: "Hi! How can I help?", created_at: "2026-01-15T10:31:00Z" },
    ],
    ...overrides,
  };
}

function makeZip(conversations: unknown[]): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AdmZip = require("adm-zip") as new () => any;
  const zip = new AdmZip();
  zip.addFile("conversations.json", Buffer.from(JSON.stringify(conversations), "utf-8"));
  return zip.toBuffer() as Buffer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeExportParser", () => {
  const parser = new ClaudeExportParser();

  it("parses valid JSON array of 3 conversations → 3 sections", async () => {
    const conversations = [
      makeConversation({ uuid: "c1", name: "Conv 1" }),
      makeConversation({ uuid: "c2", name: "Conv 2" }),
      makeConversation({ uuid: "c3", name: "Conv 3" }),
    ];
    const json = JSON.stringify(conversations);

    const doc = await parser.parse(json, "conversations.json");

    expect(doc.sections).toHaveLength(3);
    expect(doc.source_file).toBe("conversations.json");
    expect(doc.total_tokens).toBeGreaterThan(0);
    expect(doc.sections[0]!.heading).toBe("Conv 1");
    expect(doc.sections[1]!.heading).toBe("Conv 2");
    expect(doc.sections[2]!.heading).toBe("Conv 3");
    expect(doc.sections[0]!.level).toBe(1);
    expect(doc.sections[0]!.page_number).toBe(1);
    expect(doc.sections[1]!.page_number).toBe(2);
  });

  it("skips conversations with no messages → correct section count", async () => {
    const conversations = [
      makeConversation({ uuid: "c1", name: "Has messages" }),
      makeConversation({ uuid: "c2", name: "No messages", chat_messages: [] }),
      makeConversation({ uuid: "c3", name: "Also has messages" }),
    ];
    const json = JSON.stringify(conversations);

    const doc = await parser.parse(json, "conversations.json");

    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]!.heading).toBe("Has messages");
    expect(doc.sections[1]!.heading).toBe("Also has messages");
  });

  it("handles content array format (not just text field)", async () => {
    const conversations = [
      makeConversation({
        uuid: "c1",
        chat_messages: [
          {
            uuid: "msg-1",
            sender: "human",
            content: [
              { type: "text", text: "Part one." },
              { type: "text", text: "Part two." },
            ],
            created_at: "2026-01-15T10:30:00Z",
          },
          {
            uuid: "msg-2",
            sender: "assistant",
            content: "A plain string content",
            created_at: "2026-01-15T10:31:00Z",
          },
        ],
      }),
    ];
    const json = JSON.stringify(conversations);

    const doc = await parser.parse(json, "conversations.json");

    expect(doc.sections).toHaveLength(1);
    const content = doc.sections[0]!.content;
    expect(content).toContain("Part one.");
    expect(content).toContain("Part two.");
    expect(content).toContain("A plain string content");
  });

  it("handles malformed conversation → skips and continues (no throw)", async () => {
    const conversations = [
      makeConversation({ uuid: "c1", name: "Good conv 1" }),
      // This will cause an issue when processed (null chat_messages)
      { uuid: "c2", name: "Bad conv", created_at: "2026-01-01T00:00:00Z", chat_messages: null },
      makeConversation({ uuid: "c3", name: "Good conv 3" }),
    ];
    const json = JSON.stringify(conversations);

    // Should not throw
    const doc = await parser.parse(json, "conversations.json");

    // At least the good convs should parse; bad one is skipped
    expect(doc.sections.length).toBeGreaterThanOrEqual(2);
    const headings = doc.sections.map((s) => s.heading);
    expect(headings).toContain("Good conv 1");
    expect(headings).toContain("Good conv 3");
  });

  it("supports ZIP: creates minimal in-memory ZIP and parses → correct sections", async () => {
    const conversations = [
      makeConversation({ uuid: "z1", name: "ZIP Conv 1" }),
      makeConversation({ uuid: "z2", name: "ZIP Conv 2" }),
    ];
    const zipBuffer = makeZip(conversations);

    const doc = await parser.parse(zipBuffer, "export.zip");

    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]!.heading).toBe("ZIP Conv 1");
    expect(doc.sections[1]!.heading).toBe("ZIP Conv 2");
    expect(doc.source_file).toBe("export.zip");
  });

  it("sets correct section metadata", async () => {
    const conversations = [makeConversation({ uuid: "meta-test" })];
    const doc = await parser.parse(JSON.stringify(conversations), "conversations.json");

    const meta = doc.sections[0]!.metadata!;
    expect(meta["conversation_uuid"]).toBe("meta-test");
    expect(meta["source_platform"]).toBe("claude_chat_export");
    expect(typeof meta["message_count"]).toBe("number");
    expect(meta["message_count"]).toBe(2);
  });

  it("formats content as Human:/Claude: prefix format", async () => {
    const conversations = [makeConversation()];
    const doc = await parser.parse(JSON.stringify(conversations), "conversations.json");

    const content = doc.sections[0]!.content;
    expect(content).toContain("Human: Hello there");
    expect(content).toContain("Claude: Hi! How can I help?");
  });

  it("truncates long conversation names to 80 chars", async () => {
    const longName = "A".repeat(100);
    const conversations = [makeConversation({ name: longName })];
    const doc = await parser.parse(JSON.stringify(conversations), "conversations.json");

    expect(doc.sections[0]!.heading!.length).toBe(80);
  });

  it("throws on invalid JSON", async () => {
    await expect(parser.parse("not valid json", "bad.json")).rejects.toThrow();
  });

  it("throws when JSON is not an array", async () => {
    await expect(parser.parse('{"key": "value"}', "obj.json")).rejects.toThrow(
      /must be an array/,
    );
  });
});
