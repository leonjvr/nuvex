// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Guide: Agent Creation Capability
 *
 * Allows the Guide agent to create new agent definitions through conversation.
 * Writes agent YAML definitions, skill files, and updates agents.yaml.
 */

import { writeFile, mkdir, readFile, access } from "node:fs/promises";
import { join }                               from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { createLogger } from "../core/logger.js";

const logger = createLogger("guide");


export interface AgentCreationSpec {
  id:           string;
  name:         string;
  tier:         1 | 2 | 3;
  division:     string;
  provider:     string;
  model:        string;
  capabilities: string[];
  budget: {
    per_task_usd:  number;
    per_month_usd: number;
  };
  description:  string;
}

export interface AgentCreationResult {
  definitionPath: string;
  skillPath:      string;
  registeredInYaml: boolean;
}


const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Validate an agent ID.
 * Must be lowercase alphanumeric with hyphens, 1-63 chars, start with a letter.
 */
export function validateAgentId(id: string): { valid: boolean; reason?: string } {
  if (!AGENT_ID_PATTERN.test(id)) {
    return {
      valid:  false,
      reason: "Agent ID must be lowercase alphanumeric (with hyphens), start with a letter, max 63 chars",
    };
  }
  if (id === "guide") {
    return { valid: false, reason: "Agent ID 'guide' is reserved for the built-in Guide agent" };
  }
  return { valid: true };
}


/**
 * Write an agent definition YAML file.
 * Path: <workDir>/agents/definitions/<id>.yaml
 */
export async function writeAgentDefinition(
  spec: AgentCreationSpec,
  workDir: string,
): Promise<string> {
  const defsDir = join(workDir, "agents", "definitions");
  await mkdir(defsDir, { recursive: true });

  const def = {
    id:           spec.id,
    name:         spec.name,
    tier:         spec.tier,
    division:     spec.division,
    provider:     spec.provider,
    model:        spec.model,
    capabilities: spec.capabilities,
    budget: {
      per_task_usd:  spec.budget.per_task_usd,
      per_month_usd: spec.budget.per_month_usd,
    },
    schedule: "on-demand",
    max_concurrent_tasks: spec.tier === 1 ? 3 : spec.tier === 2 ? 5 : 10,
    checkpoint_interval_seconds: 60,
  };

  const yamlStr = stringifyYaml(def);
  const filePath = join(defsDir, `${spec.id}.yaml`);
  await writeFile(filePath, yamlStr, "utf-8");

  logger.info("guide_agent_created", `Guide created agent definition: ${spec.id}`, {
    metadata: { id: spec.id, tier: spec.tier, provider: spec.provider },
  });

  return filePath;
}

/**
 * Write a skill file for a new agent.
 * Path: <workDir>/agents/skills/<id>.md
 */
export async function writeSkillFile(
  agentId:      string,
  skillContent: string,
  workDir:      string,
): Promise<string> {
  const skillsDir = join(workDir, "agents", "skills");
  await mkdir(skillsDir, { recursive: true });

  const filePath = join(skillsDir, `${agentId}.md`);
  await writeFile(filePath, skillContent, "utf-8");

  logger.info("guide_skill_created", `Guide created skill file: ${agentId}.md`, {
    metadata: { agentId },
  });

  return filePath;
}

/**
 * Register the new agent in agents/agents.yaml.
 * Creates the file if it doesn't exist; appends if it does.
 */
export async function registerInAgentsYaml(
  agentId: string,
  workDir: string,
): Promise<void> {
  const agentsYamlPath = join(workDir, "agents", "agents.yaml");

  let existing: { agents?: string[] } = { agents: [] };
  try {
    await access(agentsYamlPath);
    const raw = await readFile(agentsYamlPath, "utf-8");
    existing = parseYaml(raw) as { agents?: string[] };
  } catch (e: unknown) {
    logger.debug("agent-creator", "agents.yaml not found — starting fresh", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }

  const agents = existing.agents ?? [];
  if (!agents.includes(agentId)) {
    agents.push(agentId);
  }

  const updated = stringifyYaml({ agents });
  const agentsDir = join(workDir, "agents");
  await mkdir(agentsDir, { recursive: true });
  await writeFile(agentsYamlPath, updated, "utf-8");
}

/**
 * Generate a default skill file for a new agent based on its spec.
 */
export function generateDefaultSkill(spec: AgentCreationSpec): string {
  const tierLabel = spec.tier === 1 ? "T1 (Strategic Lead)" :
                    spec.tier === 2 ? "T2 (Department Head)" : "T3 (Specialist/Worker)";

  return `# ${spec.name} — Agent Skill Definition

## Identity

You are **${spec.name}**, an AI agent in the SIDJUA governance platform.
${spec.description ? `\n${spec.description}\n` : ""}
**Tier**: ${tierLabel}
**Division**: ${spec.division}

## Capabilities

${spec.capabilities.map((c) => `- ${c}`).join("\n")}

## Work Style

- Focus on your assigned tasks and complete them thoroughly
- Ask for clarification when requirements are ambiguous
- Report results clearly with a management summary
- Escalate issues beyond your authority to your supervisor

## Output Standards

When completing tasks:
1. Write the result to the designated output file
2. Include a management summary: scope, approach, outcome, cost
3. Flag any issues or risks discovered during execution
`;
}

/**
 * Create a complete agent (definition + skill + agents.yaml entry).
 */
export async function createAgent(
  spec:    AgentCreationSpec,
  workDir: string,
): Promise<AgentCreationResult> {
  const validation = validateAgentId(spec.id);
  if (!validation.valid) {
    throw new Error(`Invalid agent ID: ${validation.reason}`);
  }

  const skillContent   = generateDefaultSkill(spec);
  const definitionPath = await writeAgentDefinition(spec, workDir);
  const skillPath      = await writeSkillFile(spec.id, skillContent, workDir);
  await registerInAgentsYaml(spec.id, workDir);

  return { definitionPath, skillPath, registeredInYaml: true };
}
