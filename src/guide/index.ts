// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Guide Module — Public API
 */

export { GuideChat, GUIDE_PRIMARY_MODEL, GUIDE_FALLBACK_MODEL, GUIDE_TIMEOUT_MS } from "./guide-chat.js";
export type { ChatMessage, ChatTurn, GuideChatOptions }                            from "./guide-chat.js";
export { createAgent, writeAgentDefinition, writeSkillFile, registerInAgentsYaml,
         validateAgentId, generateDefaultSkill }                                   from "./agent-creator.js";
export type { AgentCreationSpec, AgentCreationResult }                             from "./agent-creator.js";
export { handleSlashCommand, parseSlashCommand, handleHelp, handleExit,
         handleAgents, handleStatus, handleKey, handleCosts }                      from "./commands.js";
export type { CommandResult, ProviderKeyResult }                                   from "./commands.js";
export { getEmbeddedAccountId, getEmbeddedToken, hasEmbeddedCredentials,
         PLACEHOLDER_ACCOUNT_ID, PLACEHOLDER_CF_TOKEN }                            from "./token.js";
