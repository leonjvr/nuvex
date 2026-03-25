// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect } from "vitest";
import { sanitizeJson5 }         from "../../src/import/openclaw-config-parser.js";

// We test sanitizeJson5 directly (pure function, no I/O).
// parseOpenClawConfig is covered by the importer integration tests.

describe("sanitizeJson5", () => {
  it("passes through plain JSON unchanged (modulo whitespace)", () => {
    const input = `{ "key": "value", "num": 42 }`;
    const result = JSON.parse(sanitizeJson5(input)) as unknown;
    expect((result as Record<string, unknown>)["key"]).toBe("value");
    expect((result as Record<string, unknown>)["num"]).toBe(42);
  });

  it("strips single-line // comments", () => {
    const input = `{
      // This is a comment
      "name": "Clawd"
    }`;
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["name"]).toBe("Clawd");
  });

  it("strips multi-line /* */ comments", () => {
    const input = `{
      /* This is a
         multi-line comment */
      "name": "bot"
    }`;
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["name"]).toBe("bot");
  });

  it("handles trailing commas in objects", () => {
    const input = `{ "a": 1, "b": 2, }`;
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["a"]).toBe(1);
    expect(result["b"]).toBe(2);
  });

  it("handles trailing commas in arrays", () => {
    const input = `{ "arr": [1, 2, 3,] }`;
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect((result["arr"] as number[])[2]).toBe(3);
  });

  it("converts single-quoted strings to double-quoted", () => {
    const input = `{ 'key': 'value' }`;
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["key"]).toBe("value");
  });

  it("quotes unquoted object keys", () => {
    const input = `{ name: "Clawd", version: 1 }`;
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["name"]).toBe("Clawd");
    expect(result["version"]).toBe(1);
  });

  it("handles a realistic openclaw.json snippet", () => {
    const input = `{
      // OpenClaw config
      identity: {
        name: 'Clawd',
        theme: 'dark',
      },
      agent: {
        model: {
          primary: 'anthropic/claude-sonnet-4-5',
        },
      },
    }`;
    const result = JSON.parse(sanitizeJson5(input)) as {
      identity: { name: string; theme: string };
      agent:    { model: { primary: string } };
    };
    expect(result.identity.name).toBe("Clawd");
    expect(result.identity.theme).toBe("dark");
    expect(result.agent.model.primary).toBe("anthropic/claude-sonnet-4-5");
  });

  it("does not break URLs with // in strings", () => {
    const input = `{ "url": "https://example.com/api" }`;
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["url"]).toBe("https://example.com/api");
  });

  it("handles empty input gracefully", () => {
    expect(sanitizeJson5("{}")).toBe("{}");
  });

  it("handles escaped backslashes in single-quoted config values (CodeQL Finding B)", () => {
    // JSON5 source: 'C:\\path\\to\\file' where \\ = one literal backslash each.
    // In JS: 4 source backslashes (\\\\) → 2 chars in the string → one JSON5 escape → one literal backslash.
    const input = "{ path: 'C:\\\\path\\\\to\\\\file' }";
    // input string: { path: 'C:\\path\\to\\file' } — two backslashes before each segment
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["path"]).toBe("C:\\path\\to\\file"); // one backslash each: C:\path\to\file
  });

  it("handles escaped single quote inside single-quoted string (backslash before apostrophe)", () => {
    // JSON5: 'it\'s great' — \' is an escaped single quote that becomes '
    const input = "{ msg: 'it\\'s great' }";
    // input string: { msg: 'it\'s great' }
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["msg"]).toBe("it's great");
  });

  it("handles double-backslash prefix (UNC-style) in single-quoted strings", () => {
    // JSON5: '\\\\host' → two escaped backslashes → two literal backslashes → \\host
    // In JS source: 8 backslashes → 4 in string → two JSON5 escape sequences → two literal backslashes
    const input = "{ share: '\\\\\\\\host' }";
    // input string: { share: '\\\\host' } — four backslashes (two JSON5 escapes = \\)
    const result = JSON.parse(sanitizeJson5(input)) as Record<string, unknown>;
    expect(result["share"]).toBe("\\\\host"); // "\\\\host" in JS = \\host (two backslashes)
  });

  it("handles nested objects with multiple JSON5 features", () => {
    const input = `{
      skills: {
        entries: {
          discord: { enabled: true, /* bundled */ apiKey: 'abc123', },
          weather: { enabled: false, },
        },
        allowBundled: ['weather', 'summarize',],
      },
    }`;
    const result = JSON.parse(sanitizeJson5(input)) as {
      skills: {
        entries: {
          discord: { enabled: boolean; apiKey: string };
          weather: { enabled: boolean };
        };
        allowBundled: string[];
      };
    };
    expect(result.skills.entries.discord.apiKey).toBe("abc123");
    expect(result.skills.allowBundled).toHaveLength(2);
  });
});
