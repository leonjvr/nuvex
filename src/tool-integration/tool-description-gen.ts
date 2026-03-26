// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.7: Tool Description Generator
 *
 * Generates LLM-readable tool descriptions for agent prompts.
 * Masks credentials found in config objects before exposing them.
 */

import type {
  ToolDescription,
  CapabilityDescription,
  ToolCapability,
  ToolConfig,
  ToolAccess,
} from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import { getFilteredToolDescriptions, type AgentVisibilityContext } from "./tool-visibility.js";


const CREDENTIAL_KEY_PATTERN = /token|password|secret|key/i;


export class ToolDescriptionGen {
  constructor(private readonly registry: ToolRegistry) {}

  // -------------------------------------------------------------------------
  // generate
  // -------------------------------------------------------------------------

  /**
   * Generate a description for a single tool.
   * Masks any credential values found in the tool's config.
   */
  generate(toolId: string): ToolDescription {
    const tool = this.registry.getById(toolId);
    const capabilities = this.registry.getCapabilities(toolId);

    const maskedConfig = this.maskCredentials(tool.config);

    const capDescriptions: CapabilityDescription[] = capabilities.map((cap) =>
      this.mapCapability(cap),
    );

    return {
      tool_id: tool.id,
      name: tool.name,
      type: tool.type,
      summary: `${tool.name} (${tool.type}) — ${capabilities.length} capabilities`,
      capabilities: capDescriptions,
    };
  }

  // -------------------------------------------------------------------------
  // generateForAgent
  // -------------------------------------------------------------------------

  /**
   * Generate descriptions for tools accessible to an agent.
   *
   * When `agentContext` and `grantedIds` are provided the list is filtered by
   * tier, division, and classification before descriptions are built — so the
   * agent only receives metadata for tools it is authorised to use.
   * Without context the full active-tool list is returned (backward-compatible).
   */
  generateForAgent(
    _agentId:     string,
    _tierLevel:   number,
    agentContext?: AgentVisibilityContext,
    grantedIds?:   ReadonlySet<string>,
    accessRules?:  ToolAccess[],
  ): ToolDescription[] {
    const activeTools = this.registry.list("active");
    const descriptions = activeTools.map((tool) => this.generate(tool.id));

    if (agentContext === undefined || grantedIds === undefined) {
      // No context provided — return all active tools (backward compatibility)
      return descriptions;
    }

    return getFilteredToolDescriptions(agentContext, descriptions, grantedIds, accessRules ?? []);
  }

  // -------------------------------------------------------------------------
  // toMarkdown
  // -------------------------------------------------------------------------

  /**
   * Format an array of ToolDescription objects as a Markdown block for
   * injection into an agent prompt.
   */
  toMarkdown(descriptions: ToolDescription[]): string {
    if (descriptions.length === 0) {
      return "";
    }

    const sections: string[] = [];

    for (const desc of descriptions) {
      const lines: string[] = [
        `## Tool: ${desc.name} [${desc.type}]`,
        desc.summary,
        "### Capabilities:",
      ];

      for (const cap of desc.capabilities) {
        const approvalTag = cap.requires_approval ? " (requires approval)" : "";
        lines.push(
          `- **${cap.name}** [${cap.risk_level}]${approvalTag}: ${cap.description}`,
        );
      }

      sections.push(lines.join("\n"));
    }

    return sections.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Recursively walk an object and replace credential values with
   * "***REDACTED***" wherever the key matches the credential pattern.
   */
  /**
   * Recursively walk an object and replace credential values with
   * "***REDACTED***" wherever the key matches the credential pattern.
   * Uses the `Object.entries(o: {})` overload which accepts any object type.
   */
  private maskCredentials(config: ToolConfig): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    // Object.entries({}) overload accepts any object; values typed as any
    for (const [key, value] of Object.entries(config)) {
      if (CREDENTIAL_KEY_PATTERN.test(key) && typeof value === "string") {
        result[key] = "***REDACTED***";
      } else if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        // Nested object: recurse treating it as a ToolConfig (compatible shape)
        result[key] = this.maskCredentials(value as ToolConfig);
      } else {
        result[key] = value as unknown;
      }
    }
    return result;
  }

  private mapCapability(cap: ToolCapability): CapabilityDescription {
    const desc: CapabilityDescription = {
      name: cap.name,
      description: cap.description,
      risk_level: cap.risk_level,
      requires_approval: cap.requires_approval,
    };

    if (Object.keys(cap.input_schema).length > 0) {
      desc.example_params = cap.input_schema;
    }

    return desc;
  }
}

// Re-export ToolConfig for consumers who import from this module
export type { ToolConfig };
