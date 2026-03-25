// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Route Resolver
 *
 * Resolves a (service, action) pair to a RouteResolution:
 *   - deterministic: known adapter found in registry
 *   - intelligent:   not in registry but intelligent path is enabled
 *   - blocked:       not in registry and intelligent path is disabled
 */

import { createLogger } from "../core/logger.js";
import type { AdapterRegistry } from "./adapter-registry.js";
import type { IntegrationConfig, RouteResolution } from "./types.js";

const logger = createLogger("route-resolver");


export class RouteResolver {
  constructor(
    private readonly registry: AdapterRegistry,
    private readonly config: IntegrationConfig,
  ) {}

  /**
   * Resolve service + action to a RouteResolution.
   *
   * Decision order:
   *  1. Adapter exists and is enabled → deterministic path
   *  2. Adapter exists but is disabled → blocked
   *  3. Adapter unknown, intelligent path on → intelligent path
   *  4. Adapter unknown, intelligent path off → blocked
   */
  resolve(service: string, action: string): RouteResolution {
    const adapter = this.registry.getAdapter(service);

    if (adapter !== undefined) {
      if (!adapter.enabled) {
        logger.debug("route-resolver", `Service '${service}' adapter is disabled — blocked`, {
          metadata: { service, action },
        });
        return {
          path:   "blocked",
          reason: `Adapter '${service}' is disabled`,
        };
      }

      const adapterAction = adapter.actions[action];
      if (adapterAction === undefined) {
        logger.debug("route-resolver", `Action '${action}' not found in adapter '${service}' — blocked`, {
          metadata: { service, action, available: Object.keys(adapter.actions) },
        });
        return {
          path:   "blocked",
          reason: `Action '${action}' not found in adapter '${service}'`,
        };
      }

      logger.debug("route-resolver", `Resolved '${service}.${action}' → deterministic`, {
        metadata: { service, action, protocol: adapter.protocol },
      });
      return {
        path:    "deterministic",
        adapter,
        action:  adapterAction,
      };
    }

    // Unknown adapter
    if (this.config.gateway.intelligent_path.enabled) {
      logger.debug("route-resolver", `Service '${service}' unknown — routing to intelligent path`, {
        metadata: { service, action },
      });
      return {
        path: "intelligent",
      };
    }

    logger.debug("route-resolver", `Service '${service}' unknown and intelligent path disabled — blocked`, {
      metadata: { service, action },
    });
    return {
      path:   "blocked",
      reason: `No adapter registered for service '${service}' and intelligent path is disabled`,
    };
  }
}
