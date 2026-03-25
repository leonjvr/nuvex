/**
 * V1.1 — messaging CLI commands unit tests
 *
 * IPC is mocked — no real orchestrator socket needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Mock IPC client
// ---------------------------------------------------------------------------

const mockSendIpc = vi.fn();

vi.mock("../../src/cli/ipc-client.js", () => ({
  sendIpc: mockSendIpc,
}));

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    existsSync: vi.fn().mockReturnValue(true), // socket always "exists"
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getRegisterFn() {
  const mod = await import("../../src/cli/commands/messaging.js");
  return mod.registerMessagingCommands;
}

function makeProgram(): Command {
  return new Command().exitOverride(); // prevents process.exit in tests
}

function mockIpcSuccess(data: Record<string, unknown>) {
  mockSendIpc.mockResolvedValue({ success: true, data, error: undefined });
}

function mockIpcFailure(error: string) {
  mockSendIpc.mockResolvedValue({ success: false, data: {}, error });
}

const capturedOutput: string[] = [];
let stdoutWrite: typeof process.stdout.write;

beforeEach(() => {
  vi.clearAllMocks();
  capturedOutput.length = 0;
  stdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (data: string | Uint8Array) => {
    capturedOutput.push(String(data));
    return true;
  };
});

afterEach(() => {
  process.stdout.write = stdoutWrite;
});

// ---------------------------------------------------------------------------
// Tests — status command
// ---------------------------------------------------------------------------

describe("sidjua messaging status", () => {
  it("prints instances when orchestrator responds", async () => {
    mockIpcSuccess({
      instances: [
        { instanceId: "tg-main", channel: "telegram", healthy: true },
      ],
    });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "status", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e; // exitOverride may throw
    }

    const output = capturedOutput.join("");
    expect(output).toContain("tg-main");
    expect(output).toContain("telegram");
    expect(output).toContain("healthy");
  });

  it("prints error when orchestrator unavailable", async () => {
    mockIpcFailure("Orchestrator not running");

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "status", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    expect(output).toContain("Error");
  });

  it("prints no instances when list is empty", async () => {
    mockIpcSuccess({ instances: [] });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "status", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    expect(output).toContain("No messaging instances");
  });

  it("outputs JSON when --json flag set", async () => {
    mockIpcSuccess({ instances: [{ instanceId: "inst-1", channel: "ws", healthy: false }] });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "status", "--json", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    const parsed = JSON.parse(output) as { instances: unknown[] };
    expect(parsed.instances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — start/stop commands
// ---------------------------------------------------------------------------

describe("sidjua messaging start/stop", () => {
  it("start calls messaging_start IPC command", async () => {
    mockIpcSuccess({ instance_id: "inst-1", action: "started" });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "start", "inst-1", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    expect(mockSendIpc).toHaveBeenCalledOnce();
    const [, req] = mockSendIpc.mock.calls[0]!;
    expect(req.command).toBe("messaging_start");
    expect(req.payload.instance_id).toBe("inst-1");
  });

  it("stop calls messaging_stop IPC command", async () => {
    mockIpcSuccess({ instance_id: "inst-1", action: "stopped" });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "stop", "inst-1", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    expect(mockSendIpc).toHaveBeenCalledOnce();
    const [, req] = mockSendIpc.mock.calls[0]!;
    expect(req.command).toBe("messaging_stop");
    expect(req.payload.instance_id).toBe("inst-1");
  });
});

// ---------------------------------------------------------------------------
// Tests — reload command
// ---------------------------------------------------------------------------

describe("sidjua messaging reload", () => {
  it("calls messaging_reload IPC command", async () => {
    mockIpcSuccess({ reloaded: true });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "reload", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    expect(mockSendIpc).toHaveBeenCalledOnce();
    const [, req] = mockSendIpc.mock.calls[0]!;
    expect(req.command).toBe("messaging_reload");
  });

  it("prints success message", async () => {
    mockIpcSuccess({ reloaded: true });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "reload", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    expect(output).toContain("reloaded");
  });
});

// ---------------------------------------------------------------------------
// Tests — map/unmap commands
// ---------------------------------------------------------------------------

describe("sidjua messaging map/unmap", () => {
  it("map calls messaging_map with correct payload", async () => {
    mockIpcSuccess({ mapped: true });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync([
        "node", "sidjua", "messaging", "map",
        "inst-1", "u-123", "alice", "admin",
        "--work-dir", "/tmp",
      ]);
    } catch (e: unknown) {
      void e;
    }

    expect(mockSendIpc).toHaveBeenCalledOnce();
    const [, req] = mockSendIpc.mock.calls[0]!;
    expect(req.command).toBe("messaging_map");
    expect(req.payload.instance_id).toBe("inst-1");
    expect(req.payload.platform_user_id).toBe("u-123");
    expect(req.payload.sidjua_user_id).toBe("alice");
    expect(req.payload.role).toBe("admin");
  });

  it("map defaults role to user", async () => {
    mockIpcSuccess({ mapped: true });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync([
        "node", "sidjua", "messaging", "map",
        "inst-1", "u-123", "alice",
        "--work-dir", "/tmp",
      ]);
    } catch (e: unknown) {
      void e;
    }

    const [, req] = mockSendIpc.mock.calls[0]!;
    expect(req.payload.role).toBe("user");
  });

  it("unmap calls messaging_unmap", async () => {
    mockIpcSuccess({ removed: true });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync([
        "node", "sidjua", "messaging", "unmap",
        "inst-1", "u-123",
        "--work-dir", "/tmp",
      ]);
    } catch (e: unknown) {
      void e;
    }

    expect(mockSendIpc).toHaveBeenCalledOnce();
    const [, req] = mockSendIpc.mock.calls[0]!;
    expect(req.command).toBe("messaging_unmap");
    expect(req.payload.instance_id).toBe("inst-1");
    expect(req.payload.platform_user_id).toBe("u-123");
  });
});

// ---------------------------------------------------------------------------
// Tests — mappings list
// ---------------------------------------------------------------------------

describe("sidjua messaging mappings", () => {
  it("lists mappings in human-readable format", async () => {
    mockIpcSuccess({
      mappings: [
        { instance_id: "inst-1", platform_user_id: "u-123", sidjua_user_id: "alice", role: "user" },
      ],
    });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "mappings", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    expect(output).toContain("inst-1");
    expect(output).toContain("u-123");
    expect(output).toContain("alice");
  });

  it("lists mappings as JSON with --json flag", async () => {
    mockIpcSuccess({
      mappings: [
        { instance_id: "inst-1", platform_user_id: "u-123", sidjua_user_id: "alice", role: "user" },
      ],
    });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "mappings", "--json", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    const parsed = JSON.parse(output) as { mappings: unknown[] };
    expect(parsed.mappings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — adapters command
// ---------------------------------------------------------------------------

describe("sidjua messaging adapters", () => {
  it("lists adapter plugins", async () => {
    mockIpcSuccess({
      adapters: [
        { name: "telegram", channel: "telegram", capabilities: ["text"] },
        { name: "websocket", channel: "websocket", capabilities: ["text", "attachments"] },
      ],
    });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "adapters", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    expect(output).toContain("telegram");
    expect(output).toContain("websocket");
  });

  it("prints no adapters message when list empty", async () => {
    mockIpcSuccess({ adapters: [] });

    const registerFn = await getRegisterFn();
    const program = makeProgram();
    registerFn(program);

    try {
      await program.parseAsync(["node", "sidjua", "messaging", "adapters", "--work-dir", "/tmp"]);
    } catch (e: unknown) {
      void e;
    }

    const output = capturedOutput.join("");
    expect(output).toContain("No adapter plugins discovered");
  });
});
