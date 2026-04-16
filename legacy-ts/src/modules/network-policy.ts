// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Module Network Policy Registry
 *
 * Each built-in module declares its external network access requirements.
 * The sandbox executor uses this registry to configure the allowed domain/port
 * allowlist for module tool execution.
 *
 * Policy rule: if a module is not in this registry it gets NO network access.
 */


export interface ModuleNetworkPolicy {
  moduleName:    string;
  /** DNS domains the module may connect to (not IPs). */
  allowedDomains: string[];
  /** TCP ports allowed. Typical: [443] for HTTPS. */
  allowedPorts:  number[];
  /** Human-readable reason shown in audit logs. */
  description:   string;
}


const MODULE_NETWORK_POLICIES: Record<string, ModuleNetworkPolicy> = {
  discord: {
    moduleName:    "discord",
    allowedDomains: [
      "discord.com",
      "gateway.discord.gg",
      "cdn.discordapp.com",
    ],
    allowedPorts:  [443],
    description:   "Discord API, Gateway WebSocket, CDN",
  },
};


/**
 * Return the network policy for a module, or null if the module is unknown.
 * Callers should treat null as deny-all (no network access).
 */
export function getModuleNetworkPolicy(moduleName: string): ModuleNetworkPolicy | null {
  return MODULE_NETWORK_POLICIES[moduleName] ?? null;
}

/**
 * Return all registered module network policies.
 */
export function listModuleNetworkPolicies(): ModuleNetworkPolicy[] {
  return Object.values(MODULE_NETWORK_POLICIES);
}
