// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10: CLI v2 command registrations
 *
 * Registers all Phase 10 runtime commands on an existing Commander program.
 * Called from src/index.ts after Phase 4 commands are registered.
 */

import type { Command } from "commander";
import { runStartCommand }             from "./commands/start.js";
import { runStopOrchestratorCommand }  from "./commands/stop-orchestrator.js";
import { runShutdownCommand }          from "./commands/shutdown.js";
import { runPauseCommand }             from "./commands/pause.js";
import { runResumeCommand }            from "./commands/resume.js";
import { runHealthCommand }            from "./commands/health.js";
import { runRunCommand }               from "./commands/run.js";
import { runTasksCommand }             from "./commands/tasks.js";
import { runTaskStopCommand }          from "./commands/task-stop.js";
import { runAgentsCommand }            from "./commands/agents.js";
import { runQueueCommand }             from "./commands/queue.js";
import { runDecideCommand }            from "./commands/decide.js";
import { runCostsCommand }             from "./commands/costs.js";
import { runLogsCommand }              from "./commands/logs.js";
import { runTaskMonitorCommand }       from "./commands/task-monitor.js";


/**
 * Register all Phase 10 runtime commands on the given Commander program.
 * Each command uses the same async handler + process.exit() pattern as Phase 4.
 */
export function registerPhase10Commands(program: Command): void {

  // ── sidjua start ──────────────────────────────────────────────────────────

  program
    .command("start")
    .description("Start the orchestrator and all configured agents")
    .option("--config <path>",     "Path to orchestrator.yaml", "governance/orchestrator.yaml")
    .option("--foreground",        "Run in foreground (default: background daemon)", false)
    .option("--log-level <level>", "Log level: debug | info | warn | error", "info")
    .option("--work-dir <path>",   "Working directory", process.cwd())
    .action(async (opts: {
      config:     string;
      foreground: boolean;
      logLevel:   string;
      workDir:    string;
    }) => {
      const exitCode = await runStartCommand({
        workDir:    opts.workDir,
        foreground: opts.foreground,
        logLevel:   opts.logLevel,
        config:     opts.config,
      });
      process.exit(exitCode);
    });

  // ── sidjua stop-orchestrator ──────────────────────────────────────────────

  program
    .command("stop-orchestrator")
    .description("Graceful orchestrator shutdown")
    .option("--force",            "Kill immediately (SIGKILL) without draining", false)
    .option("--timeout <seconds>","Max drain time in seconds", "60")
    .option("--work-dir <path>",  "Working directory", process.cwd())
    .action(async (opts: { force: boolean; timeout: string; workDir: string }) => {
      const exitCode = await runStopOrchestratorCommand({
        workDir: opts.workDir,
        force:   opts.force,
        timeout: parseInt(opts.timeout, 10) || 60,
      });
      process.exit(exitCode);
    });

  // ── sidjua shutdown ───────────────────────────────────────────────────────

  program
    .command("shutdown")
    .description("Gracefully shut down SIDJUA (drain tasks, flush WAL, stop services)")
    .option("--timeout <seconds>", "Max drain time in seconds", "30")
    .option("--force",             "Skip drain, flush state and stop immediately", false)
    .option("--work-dir <path>",   "Working directory", process.cwd())
    .action(async (opts: { timeout: string; force: boolean; workDir: string }) => {
      const exitCode = await runShutdownCommand({
        workDir: opts.workDir,
        timeout: parseInt(opts.timeout, 10) || 30,
        force:   opts.force,
      });
      process.exit(exitCode);
    });

  // ── sidjua pause ─────────────────────────────────────────────────────────

  program
    .command("pause")
    .description("Pause the orchestrator (stop accepting new tasks)")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: { workDir: string }) => {
      const exitCode = await runPauseCommand({ workDir: opts.workDir });
      process.exit(exitCode);
    });

  // ── sidjua resume ────────────────────────────────────────────────────────

  program
    .command("resume")
    .description("Resume a paused orchestrator")
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: { workDir: string }) => {
      const exitCode = await runResumeCommand({ workDir: opts.workDir });
      process.exit(exitCode);
    });

  // ── sidjua health ────────────────────────────────────────────────────────

  program
    .command("health")
    .description("System health check")
    .option("--json",            "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action((opts: { json: boolean; workDir: string }) => {
      const exitCode = runHealthCommand({ workDir: opts.workDir, json: opts.json });
      process.exit(exitCode);
    });

  // ── sidjua run ────────────────────────────────────────────────────────────

  program
    .command("run [description]")
    .description("Submit a task to the orchestrator")
    .option("--file <path>",      "Path to task YAML file")
    .option("--priority <level>", "Task priority: critical|urgent|regular|low|background", "regular")
    .option("--division <code>",  "Target division")
    .option("--budget <tokens>",  "Token budget limit", "100000")
    .option("--cost-limit <usd>", "Cost limit in USD", "5.0")
    .option("--tier <n>",         "Target tier (1-3)", "1")
    .option("--wait",             "Block until task completes", false)
    .option("--timeout <seconds>","Max wait time with --wait", "600")
    .option("--json",             "Output in JSON format", false)
    .option("--work-dir <path>",  "Working directory", process.cwd())
    .action(async (description: string | undefined, opts: {
      file?:      string;
      priority:   string;
      division?:  string;
      budget:     string;
      costLimit:  string;
      tier:       string;
      wait:       boolean;
      timeout:    string;
      json:       boolean;
      workDir:    string;
    }) => {
      const exitCode = await runRunCommand({
        workDir:     opts.workDir,
        description,
        file:        opts.file,
        priority:    opts.priority,
        division:    opts.division,
        budget:      parseInt(opts.budget, 10)   || 100_000,
        costLimit:   parseFloat(opts.costLimit)  || 5.0,
        tier:        parseInt(opts.tier, 10)     || 1,
        wait:        opts.wait,
        timeout:     parseInt(opts.timeout, 10)  || 600,
        json:        opts.json,
      });
      process.exit(exitCode);
    });

  // ── sidjua tasks ─────────────────────────────────────────────────────────

  program
    .command("tasks [id]")
    .description("List and inspect tasks")
    .option("--status <s>",       "Filter: active|pending|running|done|failed|all", "active")
    .option("--division <code>",  "Filter by division")
    .option("--agent <id>",       "Filter by agent")
    .option("--tier <n>",         "Filter by tier")
    .option("--limit <n>",        "Max entries", "20")
    .option("--json",             "Output in JSON format", false)
    .option("--summary",          "Show result_summary only (with task ID)", false)
    .option("--result",           "Output full result file", false)
    .option("--tree",             "Show ASCII tree", false)
    .option("--work-dir <path>",  "Working directory", process.cwd())
    .action(async (id: string | undefined, opts: {
      status:   string;
      division?: string;
      agent?:   string;
      tier?:    string;
      limit:    string;
      json:     boolean;
      summary:  boolean;
      result:   boolean;
      tree:     boolean;
      workDir:  string;
    }) => {
      const exitCode = await runTasksCommand({
        workDir:  opts.workDir,
        taskId:   id,
        status:   opts.status,
        division: opts.division,
        agent:    opts.agent,
        tier:     opts.tier !== undefined ? parseInt(opts.tier, 10) : undefined,
        limit:    parseInt(opts.limit, 10) || 20,
        json:     opts.json,
        summary:  opts.summary,
        result:   opts.result,
        tree:     opts.tree,
      });
      process.exit(exitCode);
    });

  // ── sidjua task stop ──────────────────────────────────────────────────────

  const taskCmd = program
    .command("task")
    .description("Task operations");

  taskCmd
    .command("stop <id>")
    .description("Cancel a task with cascading sub-task cancellation")
    .option("--force",          "Skip confirmation prompt", false)
    .option("--reason <text>",  "Cancellation reason", "user_cancelled")
    .option("--json",           "Output in JSON format", false)
    .option("--work-dir <path>","Working directory", process.cwd())
    .action(async (id: string, opts: {
      force:   boolean;
      reason:  string;
      json:    boolean;
      workDir: string;
    }) => {
      const exitCode = await runTaskStopCommand({
        workDir: opts.workDir,
        taskId:  id,
        force:   opts.force,
        reason:  opts.reason,
        json:    opts.json,
      });
      process.exit(exitCode);
    });

  // ── sidjua task <id> --watch / --result / --tree / --cancel ───────────────

  taskCmd
    .command("watch <id>")
    .description("Live progress display for a running task")
    .option("--timeout <seconds>", "Max watch time in seconds", "600")
    .option("--work-dir <path>",   "Working directory", process.cwd())
    .action(async (id: string, opts: { timeout: string; workDir: string }) => {
      const exitCode = await runTaskMonitorCommand({
        workDir:  opts.workDir,
        taskId:   id,
        watch:    true,
        result:   false,
        tree:     false,
        cancel:   false,
        json:     false,
        timeout:  parseInt(opts.timeout, 10) || 600,
      });
      process.exit(exitCode);
    });

  taskCmd
    .command("result <id>")
    .description("Print the full result of a completed task")
    .option("--json",            "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (id: string, opts: { json: boolean; workDir: string }) => {
      const exitCode = await runTaskMonitorCommand({
        workDir:  opts.workDir,
        taskId:   id,
        watch:    false,
        result:   true,
        tree:     false,
        cancel:   false,
        json:     opts.json,
        timeout:  300,
      });
      process.exit(exitCode);
    });

  taskCmd
    .command("tree <id>")
    .description("Print delegation tree for a task")
    .option("--json",            "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (id: string, opts: { json: boolean; workDir: string }) => {
      const exitCode = await runTaskMonitorCommand({
        workDir:  opts.workDir,
        taskId:   id,
        watch:    false,
        result:   false,
        tree:     true,
        cancel:   false,
        json:     opts.json,
        timeout:  300,
      });
      process.exit(exitCode);
    });

  taskCmd
    .command("cancel <id>")
    .description("Cancel a running task and all sub-tasks")
    .option("--json",            "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (id: string, opts: { json: boolean; workDir: string }) => {
      const exitCode = await runTaskMonitorCommand({
        workDir:  opts.workDir,
        taskId:   id,
        watch:    false,
        result:   false,
        tree:     false,
        cancel:   true,
        json:     opts.json,
        timeout:  300,
      });
      process.exit(exitCode);
    });

  // ── sidjua agents ─────────────────────────────────────────────────────────

  program
    .command("agents [id]")
    .description("List and inspect agents")
    .option("--tier <n>",        "Filter by tier")
    .option("--status <s>",      "Filter: idle|busy|overloaded|crashed")
    .option("--json",            "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action((id: string | undefined, opts: {
      tier?:   string;
      status?: string;
      json:    boolean;
      workDir: string;
    }) => {
      const exitCode = runAgentsCommand({
        workDir: opts.workDir,
        agentId: id,
        tier:    opts.tier !== undefined ? parseInt(opts.tier, 10) : undefined,
        status:  opts.status,
        json:    opts.json,
      });
      process.exit(exitCode);
    });

  // ── sidjua queue ──────────────────────────────────────────────────────────

  program
    .command("queue")
    .description("View Task Pipeline queue status")
    .option("--agent <id>",      "Filter by consumer agent")
    .option("--json",            "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action((opts: { agent?: string; json: boolean; workDir: string }) => {
      const exitCode = runQueueCommand({
        workDir: opts.workDir,
        agent:   opts.agent,
        json:    opts.json,
      });
      process.exit(exitCode);
    });

  // ── sidjua decide ─────────────────────────────────────────────────────────

  program
    .command("decide [id]")
    .description("Handle human decisions for escalated tasks")
    .option("--action <a>",          "retry|cancel|reassign|resolve")
    .option("--guidance <text>",     "Additional instructions (for retry)")
    .option("--agent <id>",          "Target agent (for reassign)")
    .option("--result <text>",       "Human-provided result (for resolve)")
    .option("--result-file <path>",  "Human-provided result from file")
    .option("--json",                "Output in JSON format", false)
    .option("--work-dir <path>",     "Working directory", process.cwd())
    .action(async (id: string | undefined, opts: {
      action?:     string;
      guidance?:   string;
      agent?:      string;
      result?:     string;
      resultFile?: string;
      json:        boolean;
      workDir:     string;
    }) => {
      const exitCode = await runDecideCommand({
        workDir:    opts.workDir,
        taskId:     id,
        action:     opts.action,
        guidance:   opts.guidance,
        agentId:    opts.agent,
        result:     opts.result,
        resultFile: opts.resultFile,
        json:       opts.json,
      });
      process.exit(exitCode);
    });

  // ── sidjua costs ──────────────────────────────────────────────────────────

  program
    .command("costs")
    .description("Cost breakdown across divisions, agents, and time periods")
    .option("--division <code>",  "Filter by division")
    .option("--agent <id>",       "Filter by agent")
    .option("--period <p>",       "Time period: 1h|24h|7d|30d|all", "24h")
    .option("--json",             "Output in JSON format", false)
    .option("--work-dir <path>",  "Working directory", process.cwd())
    .action((opts: {
      division?: string;
      agent?:    string;
      period:    string;
      json:      boolean;
      workDir:   string;
    }) => {
      const exitCode = runCostsCommand({
        workDir:  opts.workDir,
        division: opts.division,
        agent:    opts.agent,
        period:   opts.period,
        json:     opts.json,
      });
      process.exit(exitCode);
    });

  // ── sidjua logs ───────────────────────────────────────────────────────────

  program
    .command("logs")
    .description("Enhanced audit trail viewer")
    .option("--task <id>",       "Filter by task (includes all sub-tasks)")
    .option("--agent <id>",      "Filter by agent")
    .option("--division <code>", "Filter by division")
    .option("--type <t>",        "Filter: delegation|escalation|pipeline|governance|all")
    .option("--since <date>",    "Filter by date (ISO 8601)")
    .option("--follow",          "Live tail mode (streams new events)", false)
    .option("--limit <n>",       "Max entries", "50")
    .option("--json",            "Output in JSON format", false)
    .option("--work-dir <path>", "Working directory", process.cwd())
    .action(async (opts: {
      task?:     string;
      agent?:    string;
      division?: string;
      type?:     string;
      since?:    string;
      follow:    boolean;
      limit:     string;
      json:      boolean;
      workDir:   string;
    }) => {
      const exitCode = await runLogsCommand({
        workDir:  opts.workDir,
        taskId:   opts.task,
        agentId:  opts.agent,
        division: opts.division,
        type:     opts.type,
        since:    opts.since,
        follow:   opts.follow,
        limit:    parseInt(opts.limit, 10) || 50,
        json:     opts.json,
      });
      process.exit(exitCode);
    });
}
