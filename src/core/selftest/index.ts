// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Selftest module barrel
 *
 * createDefaultRunner() builds the fully-configured SelftestRunner with all
 * standard checks registered. CLI and REST API both call this to avoid any
 * duplication.
 */

export { SelftestRunner }        from "./selftest-runner.js";
export type { SelftestReport, SelftestContext, CheckResult, CheckStatus, SelftestCheck } from "./selftest-runner.js";

import { SelftestRunner }             from "./selftest-runner.js";
import { WorkDirExists, ConfigFileValid, DatabasesAccessible, DirectoryStructure } from "./checks/workspace-checks.js";
import { ProviderApiKeyValid, ProviderConnectivity }                               from "./checks/provider-checks.js";
import { AgentDatabaseIntegrity, AgentConfigValid }                                from "./checks/agent-checks.js";
import { GovernanceRulesLoadable, PolicyEnforcementFunctional, DivisionConfigConsistent } from "./checks/governance-checks.js";
import { DiskSpace, PortAvailability, NodeVersion }                                from "./checks/resource-checks.js";
import { DockerAvailable, ContainerHealthy }                                       from "./checks/docker-checks.js";
import { NodeModulesPresent, CriticalDepsVersions }                                from "./checks/dependency-checks.js";

/** Known categories for --category filtering. */
export const KNOWN_CATEGORIES = [
  "workspace",
  "provider",
  "agent",
  "governance",
  "resource",
  "docker",
  "dependency",
] as const;

export type CheckCategory = (typeof KNOWN_CATEGORIES)[number];

/**
 * Build a SelftestRunner with all standard checks registered.
 *
 * @param categories - If provided, only checks matching these categories are registered.
 */
export function createDefaultRunner(categories?: readonly string[]): SelftestRunner {
  const runner = new SelftestRunner();
  const include = (cat: string) =>
    categories === undefined || categories.length === 0 || categories.includes(cat);

  if (include("workspace")) {
    runner.registerCheck(WorkDirExists);
    runner.registerCheck(ConfigFileValid);
    runner.registerCheck(DatabasesAccessible);
    runner.registerCheck(DirectoryStructure);
  }

  if (include("provider")) {
    runner.registerCheck(ProviderApiKeyValid);
    runner.registerCheck(ProviderConnectivity);
  }

  if (include("agent")) {
    runner.registerCheck(AgentDatabaseIntegrity);
    runner.registerCheck(AgentConfigValid);
  }

  if (include("governance")) {
    runner.registerCheck(GovernanceRulesLoadable);
    runner.registerCheck(PolicyEnforcementFunctional);
    runner.registerCheck(DivisionConfigConsistent);
  }

  if (include("resource")) {
    runner.registerCheck(DiskSpace);
    runner.registerCheck(PortAvailability);
    runner.registerCheck(NodeVersion);
  }

  if (include("docker")) {
    runner.registerCheck(DockerAvailable);
    runner.registerCheck(ContainerHealthy);
  }

  if (include("dependency")) {
    runner.registerCheck(NodeModulesPresent);
    runner.registerCheck(CriticalDepsVersions);
  }

  return runner;
}
