// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: MessagingConfigLoader
 *
 * Loads and parses governance/messaging.yaml.
 * Returns a validated MessagingConfig with governance defaults and instance list.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AdapterInstanceConfig, MessagingGovernance } from "./types.js";


export interface MessagingConfig {
  governance: MessagingGovernance;
  instances:  AdapterInstanceConfig[];
}


const DEFAULT_GOVERNANCE: MessagingGovernance = {
  require_mapping:             true,
  allow_self_register:         false,
  response_max_length:         4000,
  include_task_id_in_response: false,
  typing_indicator:            false,
  max_inbound_per_hour:        1000,
};


/**
 * Load the messaging config from `{workDir}/governance/messaging.yaml`.
 *
 * If the file does not exist, returns the default config with no instances.
 * Unknown governance fields are silently ignored.
 *
 * @param workDir Root of the SIDJUA workspace.
 */
export function loadMessagingConfig(workDir: string): MessagingConfig {
  const configPath = join(workDir, "governance", "messaging.yaml");

  if (!existsSync(configPath)) {
    return {
      governance: { ...DEFAULT_GOVERNANCE },
      instances:  [],
    };
  }

  const raw = readFileSync(configPath, "utf8");
  const doc = parseYaml(raw) as Record<string, unknown> | null;

  if (doc === null || typeof doc !== "object") {
    return {
      governance: { ...DEFAULT_GOVERNANCE },
      instances:  [],
    };
  }

  // Governance — merge defaults with file values
  const rawGov  = (doc["governance"] ?? {}) as Record<string, unknown>;
  const governance: MessagingGovernance = {
    require_mapping:             rawGov["require_mapping"]             as boolean  ?? DEFAULT_GOVERNANCE.require_mapping,
    allow_self_register:         rawGov["allow_self_register"]         as boolean  ?? DEFAULT_GOVERNANCE.allow_self_register,
    response_max_length:         rawGov["response_max_length"]         as number   ?? DEFAULT_GOVERNANCE.response_max_length,
    include_task_id_in_response: rawGov["include_task_id_in_response"] as boolean  ?? DEFAULT_GOVERNANCE.include_task_id_in_response,
    typing_indicator:            rawGov["typing_indicator"]            as boolean  ?? DEFAULT_GOVERNANCE.typing_indicator,
    max_inbound_per_hour:        rawGov["max_inbound_per_hour"]        as number   ?? DEFAULT_GOVERNANCE.max_inbound_per_hour,
  };

  // Instances — filter to enabled only
  const rawInstances = Array.isArray(doc["instances"]) ? doc["instances"] : [];
  const instances: AdapterInstanceConfig[] = rawInstances
    .filter((i: unknown) => typeof i === "object" && i !== null)
    .map((i: unknown) => {
      const item = i as Record<string, unknown>;
      return {
        id:                 String(item["id"]      ?? ""),
        adapter:            String(item["adapter"]  ?? ""),
        enabled:            Boolean(item["enabled"] ?? true),
        config:             (item["config"]         as Record<string, unknown>) ?? {},
        rate_limit_per_min: Number(item["rate_limit_per_min"] ?? 0),
      };
    })
    .filter((i) => i.id !== "" && i.adapter !== "");

  return { governance, instances };
}
