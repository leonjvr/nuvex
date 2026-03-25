/**
 * V1.1 — Daemon CLI command tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import {
  runDaemonStatusCommand,
  runDaemonControlCommand,
} from "../../src/cli/commands/daemon.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return { ...orig, existsSync: vi.fn() };
});

vi.mock("../../src/cli/ipc-client.js", () => ({
  sendIpc: vi.fn(),
}));

import { sendIpc } from "../../src/cli/ipc-client.js";

const mockExistsSync = vi.mocked(existsSync);
const mockSendIpc    = vi.mocked(sendIpc);

const WORK_DIR = "/fake/work";

// ---------------------------------------------------------------------------
// Status command tests
// ---------------------------------------------------------------------------

describe("runDaemonStatusCommand()", () => {
  let stdout: string[] = [];
  let stderr: string[] = [];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      stdout.push(String(data));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((data) => {
      stderr.push(String(data));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 1 when orchestrator socket does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const code = await runDaemonStatusCommand({ workDir: WORK_DIR, json: false });
    expect(code).toBe(1);
  });

  it("outputs JSON error when socket missing and json=true", async () => {
    mockExistsSync.mockReturnValue(false);
    const code = await runDaemonStatusCommand({ workDir: WORK_DIR, json: true });
    expect(code).toBe(1);
    expect(stdout.join("")).toContain("not_running");
  });

  it("shows daemon table when IPC succeeds", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r1",
      success:    true,
      data: {
        daemons: [
          {
            agent_id:        "agent-1",
            running:         true,
            tasks_completed: 10,
            tasks_failed:    2,
            last_task_at:    null,
            started_at:      new Date().toISOString(),
            hourly_cost_usd: 0.05,
          },
        ],
      },
    });

    const code = await runDaemonStatusCommand({ workDir: WORK_DIR, json: false });
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("agent-1");
    expect(stdout.join("")).toContain("DAEMON STATUS");
  });

  it("outputs JSON when json=true and IPC succeeds", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r2",
      success:    true,
      data: { daemons: [] },
    });

    const code = await runDaemonStatusCommand({ workDir: WORK_DIR, json: true });
    expect(code).toBe(0);
    const output = stdout.join("");
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("filters by agent-id when provided", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r3",
      success: true,
      data:    { daemons: [] },
    });

    await runDaemonStatusCommand({ agentId: "agent-1", workDir: WORK_DIR, json: false });

    expect(mockSendIpc).toHaveBeenCalledWith(
      expect.stringContaining("orchestrator.sock"),
      expect.objectContaining({
        command: "daemon_status",
        payload: { agent_id: "agent-1" },
      }),
    );
  });

  it("returns 1 when IPC reports error", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r4",
      success:    false,
      data:       {},
      error:      "internal error",
    });

    const code = await runDaemonStatusCommand({ workDir: WORK_DIR, json: false });
    expect(code).toBe(1);
  });

  it("returns 0 with 'No daemon loops running' message for empty list", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r5",
      success:    true,
      data:       { daemons: [] },
    });

    const code = await runDaemonStatusCommand({ workDir: WORK_DIR, json: false });
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("No daemon loops running");
  });
});

// ---------------------------------------------------------------------------
// Control command tests (start / stop / restart)
// ---------------------------------------------------------------------------

describe("runDaemonControlCommand()", () => {
  let stdout: string[] = [];
  let stderr: string[] = [];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation((data) => {
      stdout.push(String(data));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((data) => {
      stderr.push(String(data));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 1 when orchestrator not running", async () => {
    mockExistsSync.mockReturnValue(false);
    const code = await runDaemonControlCommand("daemon_start", "agent-1", WORK_DIR);
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("not running");
  });

  it("daemon_start sends correct IPC command", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r10",
      success:    true,
      data:       { agent_id: "agent-1", action: "started" },
    });

    const code = await runDaemonControlCommand("daemon_start", "agent-1", WORK_DIR);
    expect(code).toBe(0);
    expect(mockSendIpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        command: "daemon_start",
        payload: { agent_id: "agent-1" },
      }),
    );
    expect(stdout.join("")).toContain("started");
  });

  it("daemon_stop sends correct IPC command", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r11",
      success:    true,
      data:       { agent_id: "agent-1", action: "stopped" },
    });

    const code = await runDaemonControlCommand("daemon_stop", "agent-1", WORK_DIR);
    expect(code).toBe(0);
    expect(mockSendIpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ command: "daemon_stop" }),
    );
  });

  it("daemon_restart sends correct IPC command", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r12",
      success:    true,
      data:       { agent_id: "agent-1", action: "restarted" },
    });

    const code = await runDaemonControlCommand("daemon_restart", "agent-1", WORK_DIR);
    expect(code).toBe(0);
    expect(mockSendIpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ command: "daemon_restart" }),
    );
  });

  it("returns 1 when IPC reports failure", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r13",
      success:    false,
      data:       {},
      error:      "daemon already running",
    });

    const code = await runDaemonControlCommand("daemon_start", "agent-1", WORK_DIR);
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("daemon already running");
  });

  it("returns 1 when IPC throws", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockRejectedValue(new Error("connection refused"));

    const code = await runDaemonControlCommand("daemon_start", "agent-1", WORK_DIR);
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("connection refused");
  });

  it("prints Starting message for daemon_start", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r14",
      success:    true,
      data:       { action: "started" },
    });

    await runDaemonControlCommand("daemon_start", "my-agent", WORK_DIR);
    expect(stdout.join("")).toContain("Starting");
    expect(stdout.join("")).toContain("my-agent");
  });

  it("prints Stopping message for daemon_stop", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r15",
      success:    true,
      data:       { action: "stopped" },
    });

    await runDaemonControlCommand("daemon_stop", "my-agent", WORK_DIR);
    expect(stdout.join("")).toContain("Stopping");
  });

  it("prints Restarting message for daemon_restart", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSendIpc.mockResolvedValue({
      request_id: "r16",
      success:    true,
      data:       { action: "restarted" },
    });

    await runDaemonControlCommand("daemon_restart", "my-agent", WORK_DIR);
    expect(stdout.join("")).toContain("Restarting");
  });
});
