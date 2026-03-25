// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for H10 Part 3/3 (#534 #519):
 *
 *   H10: Error swallowing cleanup — modules, utils, and final sweep
 *
 * Verifies:
 *   1. No remaining void-e in entire src/ tree (zero-tolerance sweep)
 *   2. Module load / Discord gateway failures log at correct levels
 *   3. Tool-integration health check failures log at WARN
 *   4. Knowledge-pipeline FTS failures log at DEBUG
 *   5. Agent memory / skill-loader failures log at appropriate levels
 *   6. Budget pre-migration guards log at DEBUG
 *   7. All cleanup-ignore annotations are explicitly marked
 *
 * Scope: src/modules/, src/utils/, src/agents/, src/orchestrator/,
 *        src/knowledge-pipeline/, src/pipeline/, src/tasks/,
 *        src/tool-integration/, src/apply/, src/import/, src/guide/,
 *        src/setup/, src/governance/ + full src/ sweep
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs   from "node:fs";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf-8");
}

function countMatches(content: string, pattern: RegExp): number {
  return (content.match(pattern) ?? []).length;
}

// ===========================================================================
// Task 1: Final sweep — ZERO void-e in entire src/
// ===========================================================================

describe("H10 final sweep: zero void-e in entire src/ tree", () => {
  it("grep confirms zero unannotated void-e in all of src/", () => {
    const count = parseInt(
      execSync(
        `grep -rn "void e\\b" src/ --include='*.ts' ` +
        `| grep -v '.test.' | grep -v '.d.ts' | grep -v 'cleanup-ignore' | wc -l`,
        { cwd: process.cwd(), encoding: "utf-8" },
      ).trim(),
      10,
    );
    expect(count).toBe(0);
  });

  it("every legitimate void-e has a cleanup-ignore annotation on the same line", () => {
    const lines = execSync(
      `grep -rn "void e\\b" src/ --include='*.ts' | grep -v '.test.' | grep -v '.d.ts'`,
      { cwd: process.cwd(), encoding: "utf-8" },
    ).trim().split("\n").filter(Boolean);

    for (const line of lines) {
      if (!line.includes("cleanup-ignore")) {
        throw new Error(`Found void-e without cleanup-ignore annotation:\n  ${line}`);
      }
    }
  });

  it("total cleanup-ignore annotations count is reasonable (sanity: > 40, < 100)", () => {
    const count = parseInt(
      execSync(
        `grep -rn "cleanup-ignore" src/ --include='*.ts' | grep -v '.test.' | wc -l`,
        { cwd: process.cwd(), encoding: "utf-8" },
      ).trim(),
      10,
    );
    // Must have meaningful cleanup-ignore entries but not an unbounded number
    expect(count).toBeGreaterThan(40);
    expect(count).toBeLessThan(100);
  });
});

// ===========================================================================
// Task 2: Discord module — logger present and messages correct
// ===========================================================================

describe("H10 DEBUG: discord-gateway.ts malformed payload", () => {
  it("discord-gateway.ts imports createLogger and logs debug for malformed payloads", () => {
    const content = readSrc("src/modules/discord/discord-gateway.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("Malformed gateway payload");
  });

  it("discord-gateway.ts has no unannotated void-e", () => {
    const content = readSrc("src/modules/discord/discord-gateway.ts");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in discord-gateway.ts: ${line.trim()}`);
      }
    }
  });
});

describe("H10 DEBUG: discord-client.ts error body parse", () => {
  it("discord-client.ts imports createLogger and logs debug for JSON parse failure", () => {
    const content = readSrc("src/modules/discord/discord-client.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("not JSON");
  });
});

// ===========================================================================
// Task 3: Knowledge pipeline — FTS failures at DEBUG
// ===========================================================================

describe("H10 DEBUG: knowledge-pipeline FTS failures", () => {
  it("hybrid-retriever.ts logs debug when FTS search fails", () => {
    const content = readSrc("src/knowledge-pipeline/retrieval/hybrid-retriever.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("FTS search failed");
  });

  it("embedding-pipeline.ts logs debug when FTS rebuild fails", () => {
    const content = readSrc("src/knowledge-pipeline/embedding/embedding-pipeline.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("FTS index rebuild failed");
  });

  it("collection-manager.ts logs debug for FTS rebuild and warn for malformed YAML", () => {
    const content = readSrc("src/knowledge-pipeline/collection-manager.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("FTS index rebuild failed");
    expect(content).toContain("logger.warn");
    expect(content).toContain("Collection config YAML malformed");
  });

  it("memory-wal.ts has cleanup-ignore for malformed WAL lines (mid-write crash skip)", () => {
    const content = readSrc("src/knowledge-pipeline/wal/memory-wal.ts");

    // Malformed WAL line skip is a legitimate crash-recovery pattern
    expect(content).toContain("cleanup-ignore");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Found unannotated void-e in memory-wal.ts: ${line.trim()}`);
      }
    }
  });
});

// ===========================================================================
// Task 4: Pipeline — pre-migration guards at DEBUG, approval WARN
// ===========================================================================

describe("H10 DEBUG: pipeline budget pre-migration guards", () => {
  it("budget.ts logs debug for all pending_reservations pre-migration cases", () => {
    const content = readSrc("src/pipeline/budget.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("pending_reservations");
    expect(content).toMatch(/pre-migration|pre-0\.9/i);

    // Should have at least 5 debug calls (5 catch blocks)
    const debugCalls = countMatches(content, /logger\.debug\(/g);
    expect(debugCalls).toBeGreaterThanOrEqual(5);
  });

  it("approval.ts logs warn for malformed metadata JSON", () => {
    const content = readSrc("src/pipeline/approval.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.warn");
    expect(content).toContain("metadata JSON malformed");
  });

  it("config-loader.ts logs debug for unreadable directory and cleanup-ignore for file detection", () => {
    const content = readSrc("src/pipeline/config-loader.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("Could not read config directory");
    expect(content).toContain("cleanup-ignore");
  });
});

// ===========================================================================
// Task 5: Agents — memory/skill/loop at appropriate levels
// ===========================================================================

describe("H10 DEBUG: agent-memory.ts file read failures", () => {
  it("memory.ts logs debug for unreadable memory/skill files", () => {
    const content = readSrc("src/agents/memory.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    // Multiple unreadable file messages
    expect(content).toContain("not readable");

    const debugCalls = countMatches(content, /logger\.debug\(/g);
    expect(debugCalls).toBeGreaterThanOrEqual(4);
  });

  it("memory.ts logs warn for DB accessibility check failure (security-relevant)", () => {
    const content = readSrc("src/agents/memory.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("DB accessibility check failed");
    expect(content).toContain("conservative");
  });

  it("memory.ts logs warn when summarize strategy fails", () => {
    const content = readSrc("src/agents/memory.ts");

    expect(content).toContain("Summarize strategy failed");
    expect(content).toContain("skipping memory compaction");
  });
});

describe("H10 WARN: skill-loader.ts Qdrant and parse failures", () => {
  it("skill-loader.ts logs warn for Qdrant unavailability", () => {
    const content = readSrc("src/agents/skill-loader.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.warn");
    expect(content).toContain("Qdrant unavailable");

    const warnCalls = countMatches(content, /logger\.warn\(/g);
    expect(warnCalls).toBeGreaterThanOrEqual(2);
  });

  it("skill-loader.ts logs warn for skill file parse failures", () => {
    const content = readSrc("src/agents/skill-loader.ts");

    expect(content).toContain("Skill file parse failed");
  });

  it("skill-loader.ts logs debug for stat failures", () => {
    const content = readSrc("src/agents/skill-loader.ts");

    expect(content).toContain("logger.debug");
    expect(content).toContain("Skill file stat failed");
  });
});

describe("H10 WARN: agent-loop.ts failures", () => {
  it("loop.ts logs warn for non-transitionable task state", () => {
    const content = readSrc("src/agents/loop.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.warn");
    expect(content).toContain("Task status transition failed");
    expect(content).toContain("terminal state");
  });

  it("loop.ts logs debug for unreadable context files", () => {
    const content = readSrc("src/agents/loop.ts");

    expect(content).toContain("logger.debug");
    expect(content).toContain("Context file not readable");
  });
});

describe("H10 WARN: reasoning-loop.ts tool parser and timeout failures", () => {
  it("reasoning-loop.ts logs warn for tool call parser failure", () => {
    const content = readSrc("src/agents/reasoning-loop.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("Tool call parser failed");
    expect(content).toContain("no_tool_call");
  });

  it("reasoning-loop.ts logs warn for retry timeout before escalation", () => {
    const content = readSrc("src/agents/reasoning-loop.ts");

    expect(content).toContain("Retry timeout");
    expect(content).toContain("escalating");
  });
});

// ===========================================================================
// Task 6: Tool integration — health checks at WARN
// ===========================================================================

describe("H10 WARN: tool-integration health check failures", () => {
  const toolFiles = [
    { file: "src/tool-integration/adapters/database-adapter.ts", msg: "Database health check failed" },
    { file: "src/tool-integration/adapters/shell-adapter.ts",    msg: "Shell adapter health check failed" },
    { file: "src/tool-integration/adapters/rest-adapter.ts",     msg: "REST adapter health check failed" },
    { file: "src/tool-integration/adapters/adb-adapter.ts",      msg: "ADB device health check failed" },
  ];

  for (const { file, msg } of toolFiles) {
    it(`${path.basename(file)} logs warn for health check failure`, () => {
      const content = readSrc(file);

      expect(content).toContain("createLogger");
      expect(content).toContain("logger.warn");
      expect(content).toContain(msg);
    });
  }

  it("tool-validator.ts logs warn for adapter validation failure", () => {
    const content = readSrc("src/tool-integration/tool-validator.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.warn");
    expect(content).toContain("Tool adapter validation failed");
  });

  it("tool-governance.ts logs warn for invalid URL", () => {
    const content = readSrc("src/tool-integration/tool-governance.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.warn");
    expect(content).toContain("Invalid URL");
  });

  it("environment-manager.ts logs warn when ssh2 is unavailable", () => {
    const content = readSrc("src/tool-integration/environment-manager.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("ssh2 module not available");
  });

  it("adb-adapter.ts has cleanup-ignore for best-effort disconnect", () => {
    const content = readSrc("src/tool-integration/adapters/adb-adapter.ts");

    expect(content).toContain("cleanup-ignore");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Unannotated void-e in adb-adapter.ts: ${line.trim()}`);
      }
    }
  });
});

// ===========================================================================
// Task 7: Tasks — event-bus and result-store
// ===========================================================================

describe("H10 WARN: tasks/event-bus.ts IPC failure", () => {
  it("event-bus.ts logs warn when IPC notification fails", () => {
    const content = readSrc("src/tasks/event-bus.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.warn");
    expect(content).toContain("IPC notification failed");
    expect(content).toContain("poll from SQLite");
  });
});

describe("H10 DEBUG: tasks/result-store.ts file not found", () => {
  it("result-store.ts logs debug for all result file not-found cases", () => {
    const content = readSrc("src/tasks/result-store.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");

    const debugCalls = countMatches(content, /logger\.debug\(/g);
    expect(debugCalls).toBeGreaterThanOrEqual(3);
  });
});

describe("H10 WARN: tasks/output-store.ts FTS fallback", () => {
  it("output-store.ts logs warn when FTS query fails and degrades to LIKE", () => {
    const content = readSrc("src/tasks/output-store.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("FTS search failed");
    expect(content).toContain("LIKE");
  });
});

// ===========================================================================
// Task 8: Orchestrator — socket cleanup and IPC JSON
// ===========================================================================

describe("H10 orchestrator: socket cleanup and invalid IPC", () => {
  it("orchestrator.ts has cleanup-ignore for socket file cleanup (best-effort OS op)", () => {
    const content = readSrc("src/orchestrator/orchestrator.ts");

    expect(content).toContain("cleanup-ignore");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Unannotated void-e in orchestrator.ts: ${line.trim()}`);
      }
    }
  });

  it("orchestrator.ts logs warn for invalid JSON from IPC client", () => {
    const content = readSrc("src/orchestrator/orchestrator.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("Invalid JSON from IPC client");
  });
});

// ===========================================================================
// Task 9: Apply, import, governance — debug for expected missing states
// ===========================================================================

describe("H10 DEBUG: apply and import modules", () => {
  it("cost-centers.ts logs debug when config file is missing", () => {
    const content = readSrc("src/apply/cost-centers.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("Cost centers config not found");
  });

  it("finalize.ts logs debug when state file is missing", () => {
    const content = readSrc("src/apply/finalize.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("State file not found");
  });

  it("openclaw-skill-converter.ts logs debug when skills directory is missing", () => {
    const content = readSrc("src/import/openclaw-skill-converter.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("Skills directory not found");
  });

  it("openclaw-importer.ts logs debug for unmappable fallback model", () => {
    const content = readSrc("src/import/openclaw-importer.ts");

    expect(content).toContain("createLogger");
    expect(content).toContain("logger.debug");
    expect(content).toContain("Fallback model not mappable");
  });
});

describe("H10: governance and guide modules", () => {
  it("rollback.ts logs debug when snapshot table is missing (pre-migration)", () => {
    const content = readSrc("src/governance/rollback.ts");

    expect(content).toContain("logger.debug");
    expect(content).toContain("Snapshot table not found");
    expect(content).toContain("pre-migration");
  });

  it("setup-assistant.ts logs warn for provider probe network failure", () => {
    const content = readSrc("src/setup/setup-assistant.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("Provider probe failed");
    expect(content).toContain("unavailable");
  });

  it("guide-chat.ts logs warn for proxy health check failure", () => {
    const content = readSrc("src/guide/guide-chat.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("Proxy health check failed");
  });
});

// ===========================================================================
// Task 10: Path utils — cleanup-ignore for mid-walk control flow
// ===========================================================================

describe("H10 cleanup-ignore: path-utils.ts mid-walk skip", () => {
  it("path-utils.ts has cleanup-ignore for all mid-walk control-flow catches", () => {
    const content = readSrc("src/utils/path-utils.ts");

    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Unannotated void-e in path-utils.ts: ${line.trim()}`);
      }
    }
  });
});

// ===========================================================================
// Task 11: index.ts — startup check must never crash
// ===========================================================================

describe("H10 cleanup-ignore: src/index.ts startup check", () => {
  it("index.ts has cleanup-ignore for startup check error suppression", () => {
    const content = readSrc("src/index.ts");

    expect(content).toContain("cleanup-ignore");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("void e") && !line.includes("cleanup-ignore")) {
        throw new Error(`Unannotated void-e in index.ts: ${line.trim()}`);
      }
    }
  });
});

// ===========================================================================
// Task 12: MCP adapter — correct severity levels
// ===========================================================================

describe("H10: mcp-adapter.ts correct severity levels", () => {
  it("mcp-adapter.ts logs warn for ping failure and debug for unparseable stdout", () => {
    const content = readSrc("src/tool-integration/adapters/mcp-adapter.ts");

    expect(content).toContain("logger.warn");
    expect(content).toContain("MCP provider ping failed");
    expect(content).toContain("logger.debug");
    expect(content).toContain("Unparseable MCP stdout");
  });
});
