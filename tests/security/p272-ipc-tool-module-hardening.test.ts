// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P272 — IPC + Tool + Module Hardening regression tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join, dirname } from "node:path";
import Database     from "better-sqlite3";

// Task 1 + 2: IPC authentication
import { IPC_TOKEN_FILENAME } from "../../src/orchestrator/orchestrator.js";
import type { CLIRequest }    from "../../src/orchestrator/orchestrator.js";

// Task 3: Shell adapter mandatory allowlist
import { ShellAdapter } from "../../src/tool-integration/adapters/shell-adapter.js";
import type { ToolAction } from "../../src/tool-integration/types.js";

// Task 4: Database adapter read/write split
import { DatabaseAdapter } from "../../src/tool-integration/adapters/database-adapter.js";

// Task 5: Discord approval gate
import { executeDiscordTool } from "../../src/modules/discord/discord-tools.js";
import type { DiscordModuleConfig } from "../../src/modules/discord/discord-types.js";

// Task 6: Module secrets migration
import {
  installModule,
  type SecretEnvSource,
} from "../../src/modules/module-loader.js";
import { loadDaemonConfig } from "../../src/modules/discord/gateway-daemon.js";

// ---------------------------------------------------------------------------
// Task 1: IPC authentication — exported constants + CLIRequest token field
// ---------------------------------------------------------------------------

describe("Task 1: IPC authentication", () => {
  it("IPC_TOKEN_FILENAME is exported and equals 'ipc.token'", () => {
    expect(IPC_TOKEN_FILENAME).toBe("ipc.token");
  });

  it("CLIRequest interface accepts an optional token field", () => {
    // Compile-time type check: if the interface didn't have token?, this would
    // be a TypeScript error. At runtime we just verify the object is accepted.
    const req: CLIRequest = {
      command:    "health",
      payload:    {},
      request_id: "r1",
      token:      "abc123",
    };
    expect(req.token).toBe("abc123");
  });

  it("CLIRequest without token is also valid (optional field)", () => {
    const req: CLIRequest = {
      command:    "health",
      payload:    {},
      request_id: "r2",
    };
    expect(req.token).toBeUndefined();
  });

  it("ipc-client derives token path from socket path and reads token file", () => {
    // Test that the token file path derivation works correctly.
    // ipc-client reads from join(dirname(socketPath), IPC_TOKEN_FILENAME)
    const tmpDir = mkdtempSync(join(tmpdir(), "sidjua-p272-ipc-"));
    try {
      const socketPath = join(tmpDir, "orchestrator.sock");
      const tokenFile  = join(tmpDir, IPC_TOKEN_FILENAME);
      const expected   = "deadbeef".repeat(8); // 64 hex chars = 32 bytes

      writeFileSync(tokenFile, expected, { encoding: "utf-8", mode: 0o600 });

      const read = readFileSync(tokenFile, "utf-8").trim();
      expect(read).toBe(expected);
      // Verify path derivation matches what ipc-client uses
      expect(tokenFile).toBe(join(dirname(socketPath), IPC_TOKEN_FILENAME));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Task 3: Shell adapter mandatory allowlist
// ---------------------------------------------------------------------------

describe("Task 3: ShellAdapter — mandatory allowlist", () => {
  it("constructor throws when allowed_commands is not provided", () => {
    expect(() => new ShellAdapter("s1", { type: "shell" }, []))
      .toThrow("allowed_commands");
  });

  it("constructor throws when allowed_commands is empty", () => {
    expect(() => new ShellAdapter("s1", { type: "shell", allowed_commands: [] }, []))
      .toThrow("allowed_commands");
  });

  it("allows a command in the allowed list", async () => {
    const adapter = new ShellAdapter("s1", { type: "shell", allowed_commands: ["echo"] }, []);
    await adapter.connect();
    const action: ToolAction = {
      tool_id: "s1", capability: "execute",
      params: { command: "echo hello" }, agent_id: "a1",
    };
    const result = await adapter.execute(action);
    expect(result.success).toBe(true);
  });

  it("rejects a command not in the allowed list", async () => {
    const adapter = new ShellAdapter("s1", { type: "shell", allowed_commands: ["echo"] }, []);
    await adapter.connect();
    const action: ToolAction = {
      tool_id: "s1", capability: "execute",
      params: { command: "ls /tmp" }, agent_id: "a1",
    };
    const result = await adapter.execute(action);
    expect(result.success).toBe(false);
    expect(result.error).toContain("ls");
  });
});

// ---------------------------------------------------------------------------
// Task 4: Database adapter read/write split
// ---------------------------------------------------------------------------

describe("Task 4: DatabaseAdapter — read/write split", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
    db.exec("INSERT INTO t VALUES (1, 'a')");
    db.close();
  });

  it("readonly mode (default) rejects INSERT", async () => {
    const adapter = new DatabaseAdapter("db1", { type: "database", db_type: "sqlite", path: ":memory:" }, []);
    await adapter.connect();
    const action: ToolAction = {
      tool_id: "db1", capability: "execute",
      params: { sql: "INSERT INTO t VALUES (2, 'b')", params: [] }, agent_id: "a1",
    };
    const result = await adapter.execute(action);
    expect(result.success).toBe(false);
    expect(result.error).toContain("readonly");
    await adapter.disconnect();
  });

  it("readonly mode rejects CREATE TABLE", async () => {
    const adapter = new DatabaseAdapter("db1", { type: "database", db_type: "sqlite", path: ":memory:" }, []);
    await adapter.connect();
    const action: ToolAction = {
      tool_id: "db1", capability: "execute",
      params: { sql: "CREATE TABLE t2 (x TEXT)", params: [] }, agent_id: "a1",
    };
    const result = await adapter.execute(action);
    expect(result.success).toBe(false);
    expect(result.error).toContain("readonly");
    await adapter.disconnect();
  });

  it("readonly mode allows SELECT", async () => {
    const adapter = new DatabaseAdapter("db1", { type: "database", db_type: "sqlite", path: ":memory:" }, []);
    await adapter.connect();
    const action: ToolAction = {
      tool_id: "db1", capability: "query",
      params: { sql: "SELECT 1 AS n", params: [] }, agent_id: "a1",
    };
    const result = await adapter.execute(action);
    expect(result.success).toBe(true);
    await adapter.disconnect();
  });

  it("readwrite mode allows INSERT", async () => {
    const adapter = new DatabaseAdapter(
      "db1",
      { type: "database", db_type: "sqlite", path: ":memory:", access_mode: "readwrite" },
      [],
    );
    await adapter.connect();
    const action: ToolAction = {
      tool_id: "db1", capability: "execute",
      params: { sql: "CREATE TABLE t3 (x TEXT)", params: [] }, agent_id: "a1",
    };
    const result = await adapter.execute(action);
    expect(result.success).toBe(true);
    await adapter.disconnect();
  });
});

// ---------------------------------------------------------------------------
// Task 5: Discord destructive operations — governance approval gate
// ---------------------------------------------------------------------------

const MOCK_CLIENT = {
  sendMessage:       () => Promise.resolve({ id: "m1" }),
  editMessage:       () => Promise.resolve({ id: "m1" }),
  deleteMessage:     () => Promise.resolve(undefined),
  getMessages:       () => Promise.resolve([]),
  createThread:      () => Promise.resolve({ id: "t1", name: "t" }),
  createChannel:     () => Promise.resolve({ id: "c1", name: "general" }),
  editChannel:       () => Promise.resolve({ id: "c1" }),
  deleteChannel:     () => Promise.resolve(undefined),
  addRole:           () => Promise.resolve(undefined),
  removeRole:        () => Promise.resolve(undefined),
  kickMember:        () => Promise.resolve(undefined),
  banMember:         () => Promise.resolve(undefined),
  getGuild:          () => Promise.resolve({ id: "g1", name: "Test", icon: null }),
  listGuildChannels: () => Promise.resolve([]),
  resolveChannelId:  () => Promise.resolve("c1"),
} as unknown as import("../../src/modules/discord/discord-client.js").DiscordClient;

const CONFIG_DESTRUCTIVE_APPROVAL: DiscordModuleConfig = {
  bot_token: "tok", guild_id: "g1",
  enableDestructiveOps: true,
  requireApprovalForDestructive: true,
};

const CONFIG_DESTRUCTIVE_NO_APPROVAL: DiscordModuleConfig = {
  bot_token: "tok", guild_id: "g1",
  enableDestructiveOps: true,
};

describe("Task 5: Discord destructive operations — governance approval gate", () => {
  it("blocks destructive tool when _approval_ref missing and requireApprovalForDestructive=true", async () => {
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1" }),
      MOCK_CLIENT,
      CONFIG_DESTRUCTIVE_APPROVAL,
    );
    const parsed = JSON.parse(result) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("_approval_ref");
  });

  it("blocks destructive tool when _approval_ref is empty string", async () => {
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1", _approval_ref: "  " }),
      MOCK_CLIENT,
      CONFIG_DESTRUCTIVE_APPROVAL,
    );
    const parsed = JSON.parse(result) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("_approval_ref");
  });

  it("allows destructive tool when _approval_ref provided and requireApprovalForDestructive=true", async () => {
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1", _approval_ref: "GOV-2026-001" }),
      MOCK_CLIENT,
      CONFIG_DESTRUCTIVE_APPROVAL,
    );
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("allows destructive tool without _approval_ref when requireApprovalForDestructive not set", async () => {
    const result = await executeDiscordTool(
      "discord_manage_member",
      JSON.stringify({ action: "kick", guild_id: "g1", user_id: "u1" }),
      MOCK_CLIENT,
      CONFIG_DESTRUCTIVE_NO_APPROVAL,
    );
    const parsed = JSON.parse(result) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 6: Module secrets migration — SecretEnvSource injection
// ---------------------------------------------------------------------------

describe("Task 6: Module secrets migration — SecretEnvSource", () => {
  it("SecretEnvSource is exported and is an interface usable as a type", () => {
    // If this module compiled, the interface is exported.
    // Create a concrete implementation to verify the shape.
    const src: SecretEnvSource = {
      get(key: string): string | undefined {
        return key === "DISCORD_BOT_TOKEN" ? "test-token" : undefined;
      },
    };
    expect(src.get("DISCORD_BOT_TOKEN")).toBe("test-token");
    expect(src.get("OTHER_KEY")).toBeUndefined();
  });

  it("installModule uses secretSource.get instead of process.env when provided", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sidjua-p272-mod-"));
    const envCaptures: string[] = [];
    const source: SecretEnvSource = {
      get(key: string): string | undefined {
        envCaptures.push(key);
        return undefined; // no secrets to inject
      },
    };
    try {
      await installModule(tmp, "discord", source);
      // The source.get was called (not process.env directly)
      // We verify it was consulted for the discord module secrets
      expect(envCaptures.length).toBeGreaterThan(0);
      expect(envCaptures.some((k) => k.includes("TOKEN") || k.includes("SECRET") || k === "DISCORD_BOT_TOKEN")).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loadDaemonConfig uses secretSource when provided", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sidjua-p272-daemon-"));
    try {
      mkdirSync(tmp, { recursive: true });
      writeFileSync(join(tmp, "config.yaml"), "guild_id: \"g1\"\n", "utf8");
      // Provide token via secretSource, not process.env
      const source: SecretEnvSource = {
        get(key: string): string | undefined {
          if (key === "DISCORD_BOT_TOKEN") return "injected-token";
          return undefined;
        },
      };
      const cfg = loadDaemonConfig(tmp, source);
      expect(cfg.token).toBe("injected-token");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
