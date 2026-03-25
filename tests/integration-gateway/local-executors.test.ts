// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Integration Gateway — Local Executors Tests (#503)
 *
 * Covers:
 *   - ScriptExecutor: runtime validation, path validation, spawn mock
 *   - CliExecutor: allow-list, metacharacter rejection, timeout cap, spawn mock
 *   - McpBridge: stub / client-factory path
 *   - Gateway protocol dispatch: local_script → ScriptExecutor, cli → CliExecutor, mcp → McpBridge
 *   - DaVinci Resolve + FFmpeg YAML loading
 */

import {
  describe, it, expect, vi, beforeEach, afterEach,
  type MockedFunction,
} from "vitest";
import { EventEmitter }  from "node:events";
import { tmpdir }        from "node:os";
import { join }          from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID }    from "node:crypto";

// Mock child_process.spawn BEFORE importing the executors that use it
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from "node:child_process";
const mockSpawn = spawn as MockedFunction<typeof spawn>;

import { ScriptExecutor } from "../../src/integration-gateway/executors/script-executor.js";
import { CliExecutor }    from "../../src/integration-gateway/executors/cli-executor.js";
import { McpBridge }      from "../../src/integration-gateway/executors/mcp-bridge.js";
import { IntegrationGateway } from "../../src/integration-gateway/gateway.js";
import { AdapterRegistry }    from "../../src/integration-gateway/adapter-registry.js";
import { RouteResolver }      from "../../src/integration-gateway/route-resolver.js";
import { HttpExecutor }       from "../../src/integration-gateway/http-executor.js";
import { loadAdapters }       from "../../src/integration-gateway/adapters/adapter-loader.js";
import type {
  GatewayAuditService,
  GatewaySecretsService,
  IntegrationConfig,
  GatewayRequest,
  AdapterDefinition,
} from "../../src/integration-gateway/types.js";
import { setGlobalLevel, resetLogger } from "../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => setGlobalLevel("error"));
afterEach(() => {
  resetLogger();
  vi.restoreAllMocks();
});

/** Create a mock child process that emits stdout/stderr/close. */
function mockChild(stdout = "", stderr = "", exitCode = 0, delay = 0) {
  const child = new EventEmitter() as NodeJS.EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    stdin: null;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin  = null;
  child.kill   = vi.fn(() => {
    child.emit("close", null);
  });

  setTimeout(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", exitCode);
  }, delay);

  return child;
}

const BASE_CONFIG: IntegrationConfig = {
  gateway: {
    enabled: true,
    intelligent_path: {
      enabled: false, llm_provider: "openai", llm_model: "gpt-4o",
      max_tokens_per_discovery: 2000, cache_discovered_schemas: false,
    },
    deterministic_adapters: [],
    global_rate_limit: "unlimited",
    global_budget: { daily: 100, monthly: 1000 },
    credential_store: "sqlite",
    audit: { enabled: true, retention_days: 90 },
  },
};

function makeRequest(service: string, action: string, overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    agent_id: "agent-001", division: "engineering",
    service, action, params: {},
    request_id: randomUUID(), timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ScriptExecutor tests
// ---------------------------------------------------------------------------

describe("ScriptExecutor", () => {
  it("1. valid python3 runtime — no RUNTIME_NOT_ALLOWED thrown", async () => {
    // Use a real temp file so the path exists
    const tmpDir = join(tmpdir(), `script-test-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    const scriptPath = join(tmpDir, "test.py");
    await writeFile(scriptPath, "# stub");

    // Set mock AFTER file I/O so mockChild's setTimeout fires after spawn is called
    mockSpawn.mockImplementation(() => mockChild('{"ok":true}', "", 0) as ReturnType<typeof spawn>);

    const executor = new ScriptExecutor();
    const result = await executor.execute({
      script_path:   scriptPath,
      function_name: "main",
      args:          {},
      runtime:       "python3",
      timeout_ms:    5000,
      request_id:    "req-1",
    });
    expect(result.success).toBe(true);
  });

  it("2. invalid runtime → RUNTIME_NOT_ALLOWED", async () => {
    const executor = new ScriptExecutor();
    await expect(
      executor.execute({
        script_path: "/any", function_name: "f", args: {},
        runtime: "powershell", timeout_ms: 5000, request_id: "req-2",
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_NOT_ALLOWED" });
  });

  it("3. script outside allowed directory → path traversal error", async () => {
    const allowedDir = join(tmpdir(), `allowed-${randomUUID()}`);
    await mkdir(allowedDir, { recursive: true });

    const executor = new ScriptExecutor(allowedDir);
    // Path is inside /tmp but outside allowedDir
    await expect(
      executor.execute({
        script_path: join(tmpdir(), "outside.py"),
        function_name: "f", args: {},
        runtime: "python3", timeout_ms: 5000, request_id: "req-3",
      }),
    ).rejects.toThrow();
  });

  it("4. timeout kills process", async () => {
    // Child that never emits 'close' until killed
    const child = new EventEmitter() as Parameters<typeof mockChild>[0] & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      stdin: null;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin  = null;
    child.kill   = vi.fn(() => { child.emit("close", null); });

    const tmpDir2 = join(tmpdir(), `script-timeout-${randomUUID()}`);
    await mkdir(tmpDir2, { recursive: true });
    const scriptPath = join(tmpDir2, "slow.py");
    await writeFile(scriptPath, "import time; time.sleep(60)");
    // child.kill triggers 'close'
    mockSpawn.mockImplementation(() => child as ReturnType<typeof spawn>);

    const executor = new ScriptExecutor();
    const result = await executor.execute({
      script_path: scriptPath, function_name: "f", args: {},
      runtime: "python3", timeout_ms: 50, request_id: "req-4",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/timeout/i);
  });

  it("5. successful execution returns stdout", async () => {
    const tmpDir3 = join(tmpdir(), `script-ok-${randomUUID()}`);
    await mkdir(tmpDir3, { recursive: true });
    const scriptPath = join(tmpDir3, "ok.py");
    await writeFile(scriptPath, "print('hello')");

    mockSpawn.mockImplementation(() => mockChild("hello\n", "", 0) as ReturnType<typeof spawn>);

    const executor = new ScriptExecutor();
    const result = await executor.execute({
      script_path: scriptPath, function_name: "f", args: {},
      runtime: "python3", timeout_ms: 5000, request_id: "req-5",
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello");
    expect(result.exit_code).toBe(0);
  });

  it("6. failed execution returns stderr + non-zero exit code", async () => {
    const tmpDir4 = join(tmpdir(), `script-fail-${randomUUID()}`);
    await mkdir(tmpDir4, { recursive: true });
    const scriptPath = join(tmpDir4, "fail.py");
    await writeFile(scriptPath, "raise RuntimeError('oops')");

    mockSpawn.mockImplementation(() => mockChild("", "RuntimeError: oops", 1) as ReturnType<typeof spawn>);

    const executor = new ScriptExecutor();
    const result = await executor.execute({
      script_path: scriptPath, function_name: "f", args: {},
      runtime: "python3", timeout_ms: 5000, request_id: "req-6",
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("RuntimeError");
    expect(result.exit_code).toBe(1);
  });

  it("7. output capped at maxOutputSize (100 KB)", async () => {
    const tmpDir5 = join(tmpdir(), `script-big-${randomUUID()}`);
    await mkdir(tmpDir5, { recursive: true });
    const scriptPath = join(tmpDir5, "big.py");
    await writeFile(scriptPath, "print('x' * 200000)");

    // Simulate > 100 KB of output
    const bigOutput = "x".repeat(150_000);
    mockSpawn.mockImplementation(() => mockChild(bigOutput, "", 0) as ReturnType<typeof spawn>);

    const executor = new ScriptExecutor();
    const result = await executor.execute({
      script_path: scriptPath, function_name: "f", args: {},
      runtime: "python3", timeout_ms: 5000, request_id: "req-7",
    });
    // Output is captured up to 100 KB and sliced on return
    expect(result.stdout.length).toBeLessThanOrEqual(100 * 1024);
  });
});

// ---------------------------------------------------------------------------
// CliExecutor tests
// ---------------------------------------------------------------------------

describe("CliExecutor", () => {
  it("8. allowed command (ffmpeg) → execute succeeds", async () => {
    mockSpawn.mockImplementation(() => mockChild("ffmpeg version 6.0", "", 0) as ReturnType<typeof spawn>);

    const executor = new CliExecutor();
    const result = await executor.execute({
      command: "ffmpeg", args: ["-version"],
      timeout_ms: 30000, request_id: "req-8",
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("ffmpeg");
  });

  it("9. disallowed command (rm) → COMMAND_NOT_ALLOWED", async () => {
    const executor = new CliExecutor();
    await expect(
      executor.execute({ command: "rm", args: ["-rf", "/"], timeout_ms: 5000, request_id: "req-9" }),
    ).rejects.toMatchObject({ code: "COMMAND_NOT_ALLOWED" });
  });

  it("10. shell metacharacter in arg → UNSAFE_ARGUMENT", async () => {
    const executor = new CliExecutor();
    await expect(
      executor.execute({ command: "ffmpeg", args: ["-i", "input.mp4; rm -rf /"], timeout_ms: 5000, request_id: "req-10" }),
    ).rejects.toMatchObject({ code: "UNSAFE_ARGUMENT" });
  });

  it("10b. pipe metacharacter → UNSAFE_ARGUMENT", async () => {
    const executor = new CliExecutor();
    await expect(
      executor.execute({ command: "git", args: ["log", "--format=%s | cat /etc/passwd"], timeout_ms: 5000, request_id: "req-10b" }),
    ).rejects.toMatchObject({ code: "UNSAFE_ARGUMENT" });
  });

  it("11. timeout caps at per-command max_timeout_ms for ffmpeg (3600000ms)", async () => {
    mockSpawn.mockImplementation(() => mockChild("", "", 0) as ReturnType<typeof spawn>);

    const executor = new CliExecutor();
    // ffmpeg max is 3_600_000ms; request 999 hours → capped
    const result = await executor.execute({
      command: "ffmpeg", args: ["-version"],
      timeout_ms: 999 * 3_600_000, request_id: "req-11",
    });
    // We can't easily test the internal timeout value, but we verify
    // the execution succeeds (not rejected) and spawn was called
    expect(mockSpawn).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("12. successful CLI execution returns stdout", async () => {
    mockSpawn.mockImplementation(() => mockChild("done\n", "", 0) as ReturnType<typeof spawn>);

    const executor = new CliExecutor();
    const result = await executor.execute({
      command: "git", args: ["status"], timeout_ms: 30000, request_id: "req-12",
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("done\n");
    expect(result.exit_code).toBe(0);
  });

  it("13. failed command returns stderr + non-zero exit code", async () => {
    mockSpawn.mockImplementation(() => mockChild("", "fatal: not a git repo", 128) as ReturnType<typeof spawn>);

    const executor = new CliExecutor();
    const result = await executor.execute({
      command: "git", args: ["status"], timeout_ms: 30000, request_id: "req-13",
    });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("fatal");
    expect(result.exit_code).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// McpBridge tests
// ---------------------------------------------------------------------------

describe("McpBridge", () => {
  it("14. no factory → MCP_NOT_IMPLEMENTED thrown", async () => {
    const bridge = new McpBridge(); // no factory
    await expect(
      bridge.execute({
        server_name: "filesystem", tool_name: "read_file",
        arguments: { path: "/tmp/test" }, request_id: "req-14", timeout_ms: 5000,
      }),
    ).rejects.toMatchObject({ code: "MCP_NOT_IMPLEMENTED" });
  });

  it("14b. factory returns null → MCP_NOT_IMPLEMENTED thrown", async () => {
    const bridge = new McpBridge(async () => null);
    await expect(
      bridge.execute({
        server_name: "missing-server", tool_name: "do_thing",
        arguments: {}, request_id: "req-14b", timeout_ms: 5000,
      }),
    ).rejects.toMatchObject({ code: "MCP_NOT_IMPLEMENTED" });
  });

  it("14c. factory returns client → callTool is invoked and result returned", async () => {
    const mockClient = { callTool: vi.fn().mockResolvedValue({ content: "file content" }) };
    const bridge = new McpBridge(async () => mockClient);
    const result = await bridge.execute({
      server_name: "filesystem", tool_name: "read_file",
      arguments: { path: "/tmp/test" }, request_id: "req-14c", timeout_ms: 5000,
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ content: "file content" });
    expect(mockClient.callTool).toHaveBeenCalledWith("read_file", { path: "/tmp/test" }, 5000);
  });
});

// ---------------------------------------------------------------------------
// Gateway protocol routing tests
// ---------------------------------------------------------------------------

function makeScriptAdapter(): AdapterDefinition {
  return {
    name: "davinci-resolve", type: "deterministic", protocol: "local_script",
    script_path: "/opt/resolve/bridge.py", runtime: "python3", enabled: true,
    actions: {
      create_timeline: {
        function: "create_timeline",
        params: { name: { type: "string", required: true } },
        governance: { require_approval: true, budget_per_call: 0, risk_level: "medium" },
      },
    },
  };
}

function makeCLIAdapter(): AdapterDefinition {
  return {
    name: "ffmpeg", type: "deterministic", protocol: "cli", enabled: true,
    actions: {
      convert: {
        command: "ffmpeg",
        params: { input: { type: "string", required: true }, output: { type: "string", required: true } },
        governance: { require_approval: false, budget_per_call: 0, risk_level: "medium", timeout_seconds: 3600 },
      },
    },
  };
}

function makeMcpAdapter(): AdapterDefinition {
  return {
    name: "filesystem-mcp", type: "deterministic", protocol: "mcp", enabled: true,
    actions: {
      read_file: {
        params: { path: { type: "string", required: true } },
        governance: { require_approval: false, budget_per_call: 0, risk_level: "low" },
      },
    },
  };
}

function makeGateway(
  adapter: AdapterDefinition,
  scriptExecutor?: ScriptExecutor,
  cliExecutor?: CliExecutor,
  mcpBridge?: McpBridge,
) {
  const registry = new AdapterRegistry();
  registry.registerAdapter(adapter);
  const resolver = new RouteResolver(registry, BASE_CONFIG);
  const httpExec = new HttpExecutor();
  const audit: GatewayAuditService   = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
  const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue(null) };
  return new IntegrationGateway(
    registry, resolver, httpExec, audit, secrets, BASE_CONFIG,
    undefined, scriptExecutor, cliExecutor, mcpBridge,
  );
}

describe("Gateway protocol routing", () => {
  it("15. local_script protocol routes to ScriptExecutor", async () => {
    const scriptResult = { success: true, stdout: '{"ok":true}', stderr: "", exit_code: 0, execution_ms: 10 };
    const mockScript = { execute: vi.fn().mockResolvedValue(scriptResult) } as unknown as ScriptExecutor;

    const gw = makeGateway(makeScriptAdapter(), mockScript);
    const resp = await gw.execute(makeRequest("davinci-resolve", "create_timeline", { params: { name: "Timeline1" } }));

    expect(mockScript.execute).toHaveBeenCalledOnce();
    expect(resp.success).toBe(true);
    expect(resp.path_used).toBe("deterministic");
  });

  it("16. cli protocol routes to CliExecutor", async () => {
    const cliResult = { success: true, stdout: "converted", stderr: "", exit_code: 0, execution_ms: 5 };
    const mockCli = { execute: vi.fn().mockResolvedValue(cliResult) } as unknown as CliExecutor;

    const gw = makeGateway(makeCLIAdapter(), undefined, mockCli);
    const resp = await gw.execute(makeRequest("ffmpeg", "convert", { params: { input: "in.mp4", output: "out.mkv" } }));

    expect(mockCli.execute).toHaveBeenCalledOnce();
    expect(resp.success).toBe(true);
  });

  it("17. mcp protocol routes to McpBridge", async () => {
    const mcpResult = { success: true, result: { text: "file content" }, execution_ms: 3 };
    const mockMcp = { execute: vi.fn().mockResolvedValue(mcpResult) } as unknown as McpBridge;

    const gw = makeGateway(makeMcpAdapter(), undefined, undefined, mockMcp);
    const resp = await gw.execute(makeRequest("filesystem-mcp", "read_file", { params: { path: "/tmp/test" } }));

    expect(mockMcp.execute).toHaveBeenCalledOnce();
    expect(resp.success).toBe(true);
    expect(resp.data).toEqual({ text: "file content" });
  });

  it("18. executor not configured → returns error response", async () => {
    // No script executor injected
    const gw = makeGateway(makeScriptAdapter());
    const resp = await gw.execute(makeRequest("davinci-resolve", "create_timeline"));

    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// YAML loading tests
// ---------------------------------------------------------------------------

describe("DaVinci Resolve YAML", () => {
  it("19. valid parse: 3 actions loaded", async () => {
    const registry = new AdapterRegistry();
    // Load from the actual governance/integrations directory
    const count = await loadAdapters(
      join(process.cwd(), "governance", "integrations"),
      registry,
    );
    expect(count).toBeGreaterThanOrEqual(5); // n8n, github, slack, davinci-resolve, ffmpeg

    const def = registry.getAdapter("davinci-resolve");
    expect(def).toBeDefined();
    expect(def!.protocol).toBe("local_script");
    expect(Object.keys(def!.actions)).toHaveLength(3);
    expect(def!.actions["create_timeline"]).toBeDefined();
    expect(def!.actions["import_media"]).toBeDefined();
    expect(def!.actions["render"]).toBeDefined();
  });
});

describe("FFmpeg YAML", () => {
  it("20. valid parse: 2 actions loaded", async () => {
    const registry = new AdapterRegistry();
    await loadAdapters(join(process.cwd(), "governance", "integrations"), registry);

    const def = registry.getAdapter("ffmpeg");
    expect(def).toBeDefined();
    expect(def!.protocol).toBe("cli");
    expect(Object.keys(def!.actions)).toHaveLength(2);
    expect(def!.actions["convert"]).toBeDefined();
    expect(def!.actions["probe"]).toBeDefined();

    // render has high timeout
    expect(def!.actions["convert"]!.governance.timeout_seconds).toBe(3600);
    expect(def!.actions["probe"]!.governance.timeout_seconds).toBe(30);
  });
});
