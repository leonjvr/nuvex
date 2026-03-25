// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: HotReconfigure
 *
 * Field-level change detection for live agent reconfiguration.
 *
 * Immediate (no restart needed): budget, model, skill, provider, capabilities,
 *   schedule, max_concurrent_tasks
 * Restart required: division, tier (RBAC rebinding / delegation rules change)
 */

import { sha256hex } from "../core/crypto-utils.js";
import { deepEqual } from "../utils/deep-equal.js";
import { stringify as stringifyYaml } from "yaml";
import type {
  AgentLifecycleDefinition,
  HotReconfigureResult,
  FieldChange,
  ReconfigureField,
} from "./types.js";


/** Fields that require agent stop + restart when changed. */
const RESTART_REQUIRED_FIELDS: Set<string> = new Set(["division", "tier"]);

/** Fields that are applied immediately without restart. */
const IMMEDIATE_FIELDS: Set<string> = new Set([
  "budget",
  "model",
  "skill",
  "provider",
  "capabilities",
  "schedule",
  "max_concurrent_tasks",
  "fallback_provider",
  "fallback_model",
  "ttl_default_seconds",
  "checkpoint_interval_seconds",
  "heartbeat_interval_seconds",
  "max_classification",
  "name",
  "description",
  "tags",
  "reports_to",
]);


export class HotReconfigure {
  /**
   * Compute the config hash for a definition.
   * The hash is a deterministic fingerprint of the serialized YAML.
   */
  computeHash(def: AgentLifecycleDefinition): string {
    const yaml = stringifyYaml(def);
    return sha256hex(yaml).slice(0, 16);
  }

  /**
   * Detect changes between old and new definitions.
   * Returns a HotReconfigureResult describing what changed and whether
   * a restart is required.
   */
  detectChanges(
    oldDef: AgentLifecycleDefinition,
    newDef: AgentLifecycleDefinition,
  ): HotReconfigureResult {
    const oldHash = this.computeHash(oldDef);
    const newHash = this.computeHash(newDef);

    if (oldHash === newHash) {
      return {
        config_hash_changed: false,
        changes: [],
        requires_restart: false,
        immediate_fields: [],
        restart_fields: [],
      };
    }

    const changes = detectFieldChanges(oldDef, newDef);
    const restartFields = changes
      .filter((c) => c.requires_restart)
      .map((c) => c.field);
    const immediateFields = changes
      .filter((c) => !c.requires_restart)
      .map((c) => c.field);

    const requiresRestart = restartFields.length > 0;

    return {
      config_hash_changed: true,
      changes,
      requires_restart: requiresRestart,
      ...(requiresRestart
        ? {
            restart_reason: `Fields requiring restart: ${restartFields.join(", ")}`,
          }
        : {}),
      immediate_fields: immediateFields,
      restart_fields: restartFields,
    };
  }

  /**
   * Apply a patch to an existing definition.
   * Returns the merged definition and the change result.
   */
  applyPatch(
    existing: AgentLifecycleDefinition,
    patch: Partial<AgentLifecycleDefinition>,
  ): { merged: AgentLifecycleDefinition; result: HotReconfigureResult } {
    const merged: AgentLifecycleDefinition = { ...existing, ...patch };

    // Merge nested budget object
    if (patch.budget !== undefined) {
      merged.budget = { ...existing.budget, ...patch.budget };
    }

    const result = this.detectChanges(existing, merged);
    return { merged, result };
  }
}


function detectFieldChanges(
  oldDef: AgentLifecycleDefinition,
  newDef: AgentLifecycleDefinition,
): FieldChange[] {
  const changes: FieldChange[] = [];

  // Top-level scalar fields
  const scalarFields: (keyof AgentLifecycleDefinition)[] = [
    "tier",
    "division",
    "provider",
    "model",
    "fallback_provider",
    "fallback_model",
    "skill",
    "name",
    "description",
    "reports_to",
    "max_concurrent_tasks",
    "checkpoint_interval_seconds",
    "ttl_default_seconds",
    "heartbeat_interval_seconds",
    "max_classification",
  ];

  for (const field of scalarFields) {
    const oldVal = oldDef[field];
    const newVal = newDef[field];
    if (oldVal !== newVal) {
      const requiresRestart = RESTART_REQUIRED_FIELDS.has(field);
      changes.push({
        field: field as ReconfigureField,
        old_value: oldVal,
        new_value: newVal,
        requires_restart: requiresRestart,
      });
    }
  }

  // Budget (deep compare — key-order-insensitive)
  if (!deepEqual(oldDef.budget ?? {}, newDef.budget ?? {})) {
    changes.push({
      field: "budget",
      old_value: oldDef.budget,
      new_value: newDef.budget,
      requires_restart: false,
    });
  }

  // Capabilities (sorted set compare — key-order-insensitive)
  const oldCapsSorted = [...(oldDef.capabilities ?? [])].sort();
  const newCapsSorted = [...(newDef.capabilities ?? [])].sort();
  if (!deepEqual(oldCapsSorted, newCapsSorted)) {
    changes.push({
      field: "capabilities",
      old_value: oldDef.capabilities,
      new_value: newDef.capabilities,
      requires_restart: false,
    });
  }

  // Schedule (deep compare — key-order-insensitive)
  if (!deepEqual(oldDef.schedule ?? {}, newDef.schedule ?? {})) {
    changes.push({
      field: "schedule",
      old_value: oldDef.schedule,
      new_value: newDef.schedule,
      requires_restart: false,
    });
  }

  // Tags (sorted set compare — key-order-insensitive)
  const oldTagsSorted = [...(oldDef.tags ?? [])].sort();
  const newTagsSorted = [...(newDef.tags ?? [])].sort();
  if (!deepEqual(oldTagsSorted, newTagsSorted)) {
    changes.push({
      field: "tags" as ReconfigureField,
      old_value: oldDef.tags,
      new_value: newDef.tags,
      requires_restart: false,
    });
  }

  return changes;
}
