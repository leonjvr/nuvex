// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

export {
  loadDefaultRoles,
  loadDefaultDivisions,
  getStarterAgents,
  getSystemDivision,
  loadApprovedProviders,
  loadKnowledgeFile,
  buildSystemPrompt,
} from "./loader.js";

export type {
  AgentRole,
  Division,
  DivisionBudget,
  RecommendedModel,
  StarterAgent,
} from "./loader.js";

export type { ApprovedProvider, ProviderCatalog } from "./provider-types.js";
