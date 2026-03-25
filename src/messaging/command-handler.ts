// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: CommandHandler
 *
 * Processes slash commands from messaging channels. Commands are mapped to
 * existing SIDJUA internals via duck-typed interfaces for testability.
 * Role hierarchy: viewer < user < admin.
 */

import type { MessageEnvelope, UserMapping } from "./types.js";
import type { ResponseRouter } from "./response-router.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("command-handler");


export type CommandRole = "viewer" | "user" | "admin";

const ROLE_RANK: Record<CommandRole, number> = { viewer: 0, user: 1, admin: 2 };


export interface AgentStatus {
  id:           string;
  status:       string;
  tier:         number;
  active_tasks: number;
}

export interface DivisionStatus {
  name:         string;
  agent_count:  number;
  active_tasks: number;
}

export interface OrchestratorLike {
  getAgentStatuses():           AgentStatus[];
  getDivisionStatuses():        DivisionStatus[];
  pauseAgent(id: string):       Promise<void>;
  resumeAgent(id: string):      Promise<void>;
  pauseAll():                   Promise<void>;
  resumeAll():                  Promise<void>;
  cancelTask(taskId: string):   Promise<void>;
}

export interface TaskSummary {
  id:             string;
  status:         string;
  description:    string;
  assigned_agent: string | null;
  cost_used:      number;
}

export interface TaskStoreLike {
  get(taskId: string):              TaskSummary | null;
  getActiveTaskCount():             number;
  getRecentTasks(limit: number):    TaskSummary[];
}

export interface DailySummary {
  spent:       number;
  limit:       number;
  tasks_count: number;
}

export interface MonthlySummary {
  spent:       number;
  limit:       number;
  today:       number;
  tasks_count: number;
}

export interface OverallBudgetStatus {
  spent:        number;
  total:        number;
  percent_used: number;
  remaining:    number;
}

export interface BudgetTrackerLike {
  getDailySummary():   DailySummary;
  getMonthlySummary(): MonthlySummary;
  getOverallStatus():  OverallBudgetStatus;
}

export interface ScheduleSummary {
  id:              string;
  enabled:         boolean;
  cron_expression: string;
  task_template:   { description: string };
}

export interface CronSchedulerLike {
  listSchedules(): ScheduleSummary[];
}


export interface CommandDefinition {
  name:        string;
  description: string;
  min_role:    CommandRole;
  usage:       string;
  handler: (
    args:     string[],
    envelope: MessageEnvelope,
    user:     UserMapping,
  ) => Promise<string>;
}


export class CommandHandler {
  private readonly commands = new Map<string, CommandDefinition>();

  constructor(
    private readonly orchestrator:   OrchestratorLike,
    private readonly taskStore:      TaskStoreLike,
    private readonly budgetTracker:  BudgetTrackerLike,
    private readonly cronScheduler:  CronSchedulerLike,
    private readonly responseRouter: ResponseRouter,
  ) {
    this._registerCommands();
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  /** Process a slash command; result is sent via responseRouter. */
  async handle(envelope: MessageEnvelope, user: UserMapping): Promise<void> {
    const text    = envelope.content.text.trim();
    const parts   = text.slice(1).split(/\s+/).filter(Boolean);
    const cmdName = (parts[0] ?? "").toLowerCase();
    const args    = parts.slice(1);

    const cmd = this.commands.get(cmdName);

    if (cmd === undefined) {
      await this.responseRouter.sendDirectMessage(
        envelope,
        `Unbekannter Befehl: /${cmdName}\nVerfügbare Befehle: /help`,
      );
      return;
    }

    if (!this._hasRole(user.role, cmd.min_role)) {
      await this.responseRouter.sendDirectMessage(
        envelope,
        `Keine Berechtigung für /${cmdName}. Erforderlich: ${cmd.min_role}`,
      );
      return;
    }

    try {
      const response = await cmd.handler(args, envelope, user);
      await this.responseRouter.sendDirectMessage(envelope, response);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("command-handler", `Command /${cmdName} failed`, {
        metadata: { command: cmdName, error: msg },
      });
      await this.responseRouter.sendDirectMessage(
        envelope,
        `Fehler bei /${cmdName}: ${msg}`,
      );
    }
  }

  /** Return all registered command definitions (for help/introspection). */
  getCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  // ---------------------------------------------------------------------------
  // Command registration
  // ---------------------------------------------------------------------------

  private _registerCommands(): void {
    this._reg({
      name:        "help",
      description: "Verfügbare Befehle anzeigen",
      min_role:    "viewer",
      usage:       "/help",
      handler:     async () => this._formatHelp(),
    });

    this._reg({
      name:        "status",
      description: "System-Übersicht",
      min_role:    "viewer",
      usage:       "/status",
      handler:     async () => {
        const agents  = this.orchestrator.getAgentStatuses();
        const running = agents.filter((a) => a.status === "running").length;
        const tasks   = this.taskStore.getActiveTaskCount();
        const budget  = this.budgetTracker.getDailySummary();
        return (
          `Status: ${running}/${agents.length} Agents aktiv | ` +
          `${tasks} Tasks laufend | ` +
          `Heute: ${budget.spent.toFixed(2)}/${budget.limit.toFixed(2)}`
        );
      },
    });

    this._reg({
      name:        "agents",
      description: "Agent-Liste + Health",
      min_role:    "viewer",
      usage:       "/agents",
      handler:     async () => {
        const agents = this.orchestrator.getAgentStatuses();
        if (agents.length === 0) return "Keine Agents registriert.";
        return agents
          .map((a) => `${a.id}: ${a.status} (T${a.tier}) | Tasks: ${a.active_tasks}`)
          .join("\n");
      },
    });

    this._reg({
      name:        "tasks",
      description: "Laufende/kürzliche Tasks",
      min_role:    "viewer",
      usage:       "/tasks [task-id]",
      handler:     async (args) => {
        if (args[0] !== undefined) {
          const task = this.taskStore.get(args[0]);
          if (task === null) return `Task ${args[0]} nicht gefunden.`;
          return [
            `Task #${task.id.slice(0, 8)}`,
            `Status: ${task.status}`,
            `Beschreibung: ${task.description.slice(0, 200)}`,
            `Agent: ${task.assigned_agent ?? "—"}`,
            `Kosten: ${task.cost_used.toFixed(2)}`,
          ].join("\n");
        }
        const tasks = this.taskStore.getRecentTasks(10);
        if (tasks.length === 0) return "Keine aktiven Tasks.";
        return tasks
          .map((t) => `#${t.id.slice(0, 8)} ${t.status} — ${t.description.slice(0, 50)}`)
          .join("\n");
      },
    });

    this._reg({
      name:        "costs",
      description: "Kosten-Übersicht",
      min_role:    "viewer",
      usage:       "/costs [today]",
      handler:     async (args) => {
        if (args[0] === "today") {
          const d = this.budgetTracker.getDailySummary();
          return `Heute: ${d.spent.toFixed(2)} / ${d.limit.toFixed(2)} (${d.tasks_count} Tasks)`;
        }
        const m = this.budgetTracker.getMonthlySummary();
        return [
          `Monat: ${m.spent.toFixed(2)} / ${m.limit.toFixed(2)}`,
          `Heute: ${m.today.toFixed(2)}`,
          `Tasks: ${m.tasks_count}`,
        ].join("\n");
      },
    });

    this._reg({
      name:        "budget",
      description: "Budget-Status",
      min_role:    "viewer",
      usage:       "/budget",
      handler:     async () => {
        const b = this.budgetTracker.getOverallStatus();
        return [
          `Budget: ${b.spent.toFixed(2)} / ${b.total.toFixed(2)} (${b.percent_used.toFixed(1)}% verbraucht)`,
          `Verbleibend: ${b.remaining.toFixed(2)}`,
        ].join("\n");
      },
    });

    this._reg({
      name:        "divisions",
      description: "Division-Übersicht",
      min_role:    "viewer",
      usage:       "/divisions",
      handler:     async () => {
        const divs = this.orchestrator.getDivisionStatuses();
        if (divs.length === 0) return "Keine Divisions konfiguriert.";
        return divs
          .map((d) => `${d.name}: ${d.agent_count} Agents, ${d.active_tasks} Tasks`)
          .join("\n");
      },
    });

    this._reg({
      name:        "schedule",
      description: "Geplante Tasks anzeigen",
      min_role:    "viewer",
      usage:       "/schedule list",
      handler:     async (args) => {
        if (args.length > 0 && args[0] !== "list") return "Nutzung: /schedule list";
        const schedules = this.cronScheduler.listSchedules();
        if (schedules.length === 0) return "Keine Schedules konfiguriert.";
        return schedules
          .map((s) =>
            `${s.id.slice(0, 8)} ${s.enabled ? "ON" : "OFF"} | ` +
            `${s.cron_expression} | ${s.task_template.description.slice(0, 40)}`,
          )
          .join("\n");
      },
    });

    this._reg({
      name:        "pause",
      description: "Agent(en) pausieren",
      min_role:    "admin",
      usage:       "/pause [agent-id]",
      handler:     async (args) => {
        if (args[0] !== undefined) {
          await this.orchestrator.pauseAgent(args[0]);
          return `Agent ${args[0]} pausiert.`;
        }
        await this.orchestrator.pauseAll();
        return "Alle Agents pausiert.";
      },
    });

    this._reg({
      name:        "resume",
      description: "Agent(en) fortsetzen",
      min_role:    "admin",
      usage:       "/resume [agent-id]",
      handler:     async (args) => {
        if (args[0] !== undefined) {
          await this.orchestrator.resumeAgent(args[0]);
          return `Agent ${args[0]} fortgesetzt.`;
        }
        await this.orchestrator.resumeAll();
        return "Alle Agents fortgesetzt.";
      },
    });

    this._reg({
      name:        "cancel",
      description: "Task abbrechen",
      min_role:    "admin",
      usage:       "/cancel <task-id>",
      handler:     async (args) => {
        if (args[0] === undefined) return "Nutzung: /cancel <task-id>";
        await this.orchestrator.cancelTask(args[0]);
        return `Task ${args[0]} abgebrochen.`;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _reg(cmd: CommandDefinition): void {
    this.commands.set(cmd.name, cmd);
  }

  private _hasRole(userRole: string, required: CommandRole): boolean {
    return (ROLE_RANK[userRole as CommandRole] ?? 0) >= ROLE_RANK[required];
  }

  private _formatHelp(): string {
    const lines: string[] = ["Verfügbare Befehle:"];
    for (const cmd of this.commands.values()) {
      lines.push(`${cmd.usage} — ${cmd.description} [${cmd.min_role}+]`);
    }
    return lines.join("\n");
  }
}
