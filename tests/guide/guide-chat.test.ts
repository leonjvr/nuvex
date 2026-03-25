/**
 * Tests for Guide: Chat Engine
 *
 * All tests mock the Cloudflare API — no real HTTP calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import {
  GuideChat,
  GUIDE_PRIMARY_MODEL,
  GUIDE_FALLBACK_MODEL,
  GUIDE_TIMEOUT_MS,
  GUIDE_PROXY_URL,
  checkProxyHealth,
} from "../../src/guide/guide-chat.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockFetch(response: {
  ok?:     boolean;
  status?: number;
  body?:   object;
  text?:   string;
}): typeof fetch {
  const { ok = true, status = 200, body } = response;

  return vi.fn().mockResolvedValue({
    ok,
    status,
    json:  () => Promise.resolve(body ?? {}),
    text:  () => Promise.resolve(response.text ?? JSON.stringify(body ?? {})),
    headers: new Headers(),
  }) as unknown as typeof fetch;
}

function makeCloudflareResponse(content: string): object {
  return {
    choices: [{
      message:       { content, tool_calls: undefined },
      finish_reason: "stop",
    }],
  };
}

function makeToolCallResponse(toolName: string, argsJson: string): object {
  return {
    choices: [{
      message: {
        content:    null,
        tool_calls: [{
          id:       "call_123",
          type:     "function",
          function: { name: toolName, arguments: argsJson },
        }],
      },
      finish_reason: "tool_calls",
    }],
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-guide-chat-"));
  vi.unstubAllEnvs();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GuideChat constants
// ---------------------------------------------------------------------------

describe("GuideChat constants", () => {
  it("exports PRIMARY_MODEL", () => {
    expect(GUIDE_PRIMARY_MODEL).toBeTruthy();
    expect(GUIDE_PRIMARY_MODEL).toContain("llama");
  });

  it("exports FALLBACK_MODEL", () => {
    expect(GUIDE_FALLBACK_MODEL).toBeTruthy();
    expect(typeof GUIDE_FALLBACK_MODEL).toBe("string");
  });

  it("exports TIMEOUT_MS as a reasonable number", () => {
    expect(GUIDE_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(GUIDE_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});

// ---------------------------------------------------------------------------
// GuideChat.isAvailable
// ---------------------------------------------------------------------------

describe("GuideChat.isAvailable", () => {
  it("returns false when no credentials are configured", () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "You are a guide.",
    });

    expect(chat.isAvailable).toBe(false);
  });

  it("returns true when both credentials are set via env", () => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "test-account");
    vi.stubEnv("SIDJUA_CF_TOKEN",      "test-token");

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "You are a guide.",
    });

    expect(chat.isAvailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GuideChat.send — offline mode
// ---------------------------------------------------------------------------

describe("GuideChat.send (offline mode)", () => {
  it("returns offline reply without calling fetch (proxyUrl: null)", async () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const mockFetch = vi.fn();
    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "You are a guide.",
      fetchFn:      mockFetch as unknown as typeof fetch,
      proxyUrl:     null,
    });

    const turn = await chat.send("Hello");

    expect(turn.reply).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("includes the user message in history after offline reply", async () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide.", proxyUrl: null });

    await chat.send("Hi there");

    const history = chat.getHistory();
    expect(history.some((m) => m.role === "user" && m.content === "Hi there")).toBe(true);
    expect(history.some((m) => m.role === "assistant")).toBe(true);
  });

  it("returns helpful offline message about commands", async () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide.", proxyUrl: null });
    const turn = await chat.send("How do I get started?");

    // Should mention /help or /key
    expect(turn.reply).toMatch(/\/help|\/key|offline/);
  });

  it("returns agent creation hint for 'create agent' query in offline mode", async () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide.", proxyUrl: null });
    const turn = await chat.send("I want to create a new agent");

    expect(turn.reply).toContain("offline");
    expect(turn.reply.toLowerCase()).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// GuideChat.send — online mode (mocked Cloudflare)
// ---------------------------------------------------------------------------

describe("GuideChat.send (online mode, mocked Cloudflare)", () => {
  beforeEach(() => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "test-account-id");
    vi.stubEnv("SIDJUA_CF_TOKEN",      "test-api-token");
  });

  it("calls Cloudflare API and returns the response", async () => {
    const mockFetch = makeMockFetch({
      body: makeCloudflareResponse("Hello! I'm the Guide."),
    });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "You are a guide.",
      fetchFn:      mockFetch,
    });

    const turn = await chat.send("Hello!");

    expect(turn.reply).toBe("Hello! I'm the Guide.");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("sends system prompt and conversation history", async () => {
    const mockFetch = makeMockFetch({
      body: makeCloudflareResponse("Got it."),
    });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "You are the SIDJUA Guide.",
      fetchFn:      mockFetch,
    });

    await chat.send("First message");

    const callBody = JSON.parse(
      (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]?.body as string,
    ) as { messages: Array<{ role: string; content: string }> };

    // First message should be system prompt
    expect(callBody.messages[0]?.role).toBe("system");
    expect(callBody.messages[0]?.content).toContain("SIDJUA Guide");
  });

  it("includes tools in API request", async () => {
    const mockFetch = makeMockFetch({
      body: makeCloudflareResponse("Sure!"),
    });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    await chat.send("Create an agent for me");

    const callBody = JSON.parse(
      (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]?.body as string,
    ) as { tools: unknown[] };

    expect(Array.isArray(callBody.tools)).toBe(true);
    expect(callBody.tools.length).toBeGreaterThan(0);
  });

  it("returns error turn on non-OK response", async () => {
    const mockFetch = makeMockFetch({
      ok:     false,
      status: 429,
      text:   "Rate limit exceeded",
    });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    const turn = await chat.send("Hello");

    expect(turn.error).toBeTruthy();
    expect(turn.reply).toContain("Rate limit");
  });

  it("builds correct Cloudflare API URL with account ID", async () => {
    const mockFetch = makeMockFetch({
      body: makeCloudflareResponse("Hi"),
    });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    await chat.send("test");

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("test-account-id");
    expect(url).toContain("cloudflare.com");
    expect(url).toContain("chat/completions");
  });

  it("maintains conversation history across multiple turns", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok:     true,
        status: 200,
        json:   () => Promise.resolve(makeCloudflareResponse(`Response ${callCount}`)),
        text:   () => Promise.resolve(""),
        headers: new Headers(),
      });
    }) as unknown as typeof fetch;

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    await chat.send("First");
    await chat.send("Second");

    const history = chat.getHistory();
    expect(history.filter((m) => m.role === "user").length).toBe(2);
    expect(history.filter((m) => m.role === "assistant").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GuideChat — tool calls (create_agent)
// ---------------------------------------------------------------------------

describe("GuideChat tool calls", () => {
  beforeEach(() => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "test-account-id");
    vi.stubEnv("SIDJUA_CF_TOKEN",      "test-api-token");
    mkdirSync(join(tmpDir, "agents", "definitions"), { recursive: true });
    mkdirSync(join(tmpDir, "agents", "skills"), { recursive: true });
  });

  it("handles create_agent tool call and creates files", async () => {
    const agentArgs = JSON.stringify({
      id:           "my-researcher",
      name:         "My Researcher",
      tier:         "3",
      division:     "engineering",
      provider:     "groq",
      model:        "llama-3.3-70b-versatile",
      capabilities: "research,synthesis",
      description:  "A test researcher",
    });

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      const body = callCount === 1
        ? makeToolCallResponse("create_agent", agentArgs)
        : makeCloudflareResponse("Agent created successfully!");

      return Promise.resolve({
        ok:     true,
        status: 200,
        json:   () => Promise.resolve(body),
        text:   () => Promise.resolve(""),
        headers: new Headers(),
      });
    }) as unknown as typeof fetch;

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    const turn = await chat.send("Create a researcher agent");

    // Two calls: one for initial, one after tool result
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(turn.toolsUsed).toContain("create_agent");
    expect(turn.reply).toContain("created");

    // Check file was created
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(tmpDir, "agents", "definitions", "my-researcher.yaml"))).toBe(true);
  });

  it("records tool name in toolsUsed list", async () => {
    const agentArgs = JSON.stringify({
      id: "test-worker", name: "Test Worker", tier: "3",
      division: "workspace", provider: "groq", model: "llama-3.3-70b-versatile",
      capabilities: "general", description: "A worker",
    });

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      const body = callCount === 1
        ? makeToolCallResponse("create_agent", agentArgs)
        : makeCloudflareResponse("Done!");

      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      });
    }) as unknown as typeof fetch;

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    const turn = await chat.send("Make me a worker");
    expect(turn.toolsUsed).toEqual(["create_agent"]);
  });
});

// ---------------------------------------------------------------------------
// GuideChat.clearHistory / getHistory
// ---------------------------------------------------------------------------

describe("GuideChat history management", () => {
  it("starts with empty history", () => {
    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide." });
    expect(chat.getHistory()).toHaveLength(0);
  });

  it("clearHistory removes all messages", async () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide.", proxyUrl: null });
    await chat.send("Hello");
    expect(chat.getHistory().length).toBeGreaterThan(0);

    chat.clearHistory();
    expect(chat.getHistory()).toHaveLength(0);
  });

  it("getHistory returns a copy (not a reference)", () => {
    const chat    = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide." });
    const history = chat.getHistory();
    history.push({ role: "user", content: "injected" });
    expect(chat.getHistory()).toHaveLength(0); // original unchanged
  });
});

// ---------------------------------------------------------------------------
// GuideChat.connectionMode
// ---------------------------------------------------------------------------

describe("GuideChat.connectionMode", () => {
  it("returns 'direct' when CF credentials are set", () => {
    vi.stubEnv("SIDJUA_CF_ACCOUNT_ID", "test-account");
    vi.stubEnv("SIDJUA_CF_TOKEN",      "test-token");

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide." });
    expect(chat.connectionMode).toBe("direct");
  });

  it("returns 'proxy' when no CF credentials (default)", () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide." });
    expect(chat.connectionMode).toBe("proxy");
  });

  it("returns 'offline' when proxyUrl is null and no CF creds", () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide.", proxyUrl: null });
    expect(chat.connectionMode).toBe("offline");
  });

  it("returns 'proxy' when custom proxyUrl is provided", () => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];

    const chat = new GuideChat({ workDir: tmpDir, systemPrompt: "Guide.", proxyUrl: "https://custom.example.com/v1" });
    expect(chat.connectionMode).toBe("proxy");
  });
});

// ---------------------------------------------------------------------------
// GuideChat.send — proxy mode (mocked proxy)
// ---------------------------------------------------------------------------

describe("GuideChat.send (proxy mode)", () => {
  beforeEach(() => {
    delete process.env["SIDJUA_CF_ACCOUNT_ID"];
    delete process.env["SIDJUA_CF_TOKEN"];
  });

  it("calls proxy when no CF credentials configured", async () => {
    const mockFetch = makeMockFetch({ body: makeCloudflareResponse("Hello from proxy!") });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    const turn = await chat.send("Hello");

    expect(turn.reply).toBe("Hello from proxy!");
    expect(mockFetch).toHaveBeenCalledOnce();
    const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("guide-api.sidjua.com");
    expect(url).toContain("/v1/chat/completions");
  });

  it("uses GUIDE_PROXY_URL as default base URL", async () => {
    const mockFetch = makeMockFetch({ body: makeCloudflareResponse("Ok") });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    await chat.send("test");

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain(GUIDE_PROXY_URL);
  });

  it("sends Authorization: Bearer guide header to proxy", async () => {
    const mockFetch = makeMockFetch({ body: makeCloudflareResponse("Ok") });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    await chat.send("test");

    const headers = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer guide");
  });

  it("shows rate limit message with /key hints on 429 from proxy", async () => {
    const mockFetch = makeMockFetch({ ok: false, status: 429, text: "Too Many Requests" });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    const turn = await chat.send("Hello");

    expect(turn.error).toBeTruthy();
    expect(turn.reply).toContain("Rate limit reached");
    expect(turn.reply).toContain("/key groq");
    expect(turn.reply).toContain("console.groq.com");
    expect(turn.reply).toContain("/key google");
    expect(turn.reply).toContain("aistudio.google.com");
  });

  it("returns error turn on non-429 error from proxy", async () => {
    const mockFetch = makeMockFetch({ ok: false, status: 500, text: "Internal Server Error" });

    const chat = new GuideChat({
      workDir:      tmpDir,
      systemPrompt: "Guide.",
      fetchFn:      mockFetch,
    });

    const turn = await chat.send("Hello");

    expect(turn.error).toBeTruthy();
    expect(turn.reply).toContain("error");
  });
});

// ---------------------------------------------------------------------------
// checkProxyHealth
// ---------------------------------------------------------------------------

describe("checkProxyHealth", () => {
  it("returns true when health endpoint returns 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });

    const result = await checkProxyHealth(mockFetch as unknown as typeof fetch);

    expect(result).toBe(true);
    const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("guide-api.sidjua.com");
    expect(url).toContain("/health");
  });

  it("returns false when health endpoint returns non-200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 503 });
    const result = await checkProxyHealth(mockFetch as unknown as typeof fetch);
    expect(result).toBe(false);
  });

  it("returns false when fetch throws (no internet)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await checkProxyHealth(mockFetch as unknown as typeof fetch);
    expect(result).toBe(false);
  });
});
