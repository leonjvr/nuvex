// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Discord Module — Entry Point
 *
 * Exports the module manifest and all public APIs.
 * The module loader imports this statically (not dynamically) for
 * better bundling and tree-shaking.
 */

import { parse as parseYaml }     from "yaml";
import type { ModuleManifest }    from "../module-types.js";
import {
  DISCORD_MODULE_YAML,
  DISCORD_AGENT_YAML,
  DISCORD_SKILL_MD,
  DISCORD_README_MD,
  DISCORD_SERVICE_FILE,
} from "./templates.js";


export const DISCORD_MODULE_MANIFEST: ModuleManifest =
  parseYaml(DISCORD_MODULE_YAML) as ModuleManifest;


export const DISCORD_TEMPLATES: Record<string, string> = {
  "module.yaml":              DISCORD_MODULE_YAML,
  "agent.yaml":               DISCORD_AGENT_YAML,
  "skill.md":                 DISCORD_SKILL_MD,
  "README.md":                DISCORD_README_MD,
  "sidjua-discord.service":   DISCORD_SERVICE_FILE,
};


export {
  getDiscordToolDefinitions,
  executeDiscordTool,
  formatDevUpdateEmbed,
  COLOR_FEATURE,
  COLOR_FIX,
  COLOR_RELEASE,
  COLOR_DEPLOYMENT,
} from "./discord-tools.js";

export { DiscordClient, DiscordApiError, DISCORD_API_BASE } from "./discord-client.js";

export type {
  DiscordModuleConfig,
  DevUpdateInput,
  DiscordMessage,
  DiscordChannel,
  DiscordGuild,
  GatewayMessage,
  GatewayPayload,
} from "./discord-types.js";

export { GatewayOpcode } from "./discord-types.js";

export { DiscordGateway, GATEWAY_INTENTS } from "./discord-gateway.js";
export type { WsLike, WsFactory, DiscordGatewayOptions } from "./discord-gateway.js";
