// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — GovernedSecretsProvider
 *
 * RBAC enforcement wrapper around any SecretsProvider.
 * Does NOT modify SqliteSecretsProvider — all permission checks live here.
 *
 * Access rules per namespace:
 *   global / providers:
 *     read  → read_secrets_global
 *     write → write_secrets_global
 *
 *   divisions/<code>:
 *     read  → read_secrets  + agent.division === code
 *     write → write_secrets + agent.division === code
 *
 *   modules/<id>:
 *     read  → read_secrets
 *     write → write_secrets
 *
 *   system_admin ("*") → bypass all checks
 */

import type { SecretsProvider, SecretMetadata, SecretsConfig, Permission } from "../types/apply.js";


export class SecretAccessDeniedError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly namespace: string,
    public readonly action: string,
    public readonly reason: string,
  ) {
    super(`[${agentId}] access denied: ${action} on "${namespace}" — ${reason}`);
    this.name = "SecretAccessDeniedError";
  }
}


export interface SecretAccessContext {
  /** Agent's unique ID */
  agentId: string;
  /** Agent's own division code */
  division: string;
  /** Effective permissions for this agent */
  permissions: Permission[];
}

export interface GovernedSecretsOptions {
  /** Called whenever access is denied — useful for audit logging */
  onDeny?: (agentId: string, namespace: string, action: string, reason: string) => void;
}


export class GovernedSecretsProvider implements SecretsProvider {
  constructor(
    private readonly inner: SecretsProvider,
    private readonly ctx: SecretAccessContext,
    private readonly opts: GovernedSecretsOptions = {},
  ) {}

  // ---------------------------------------------------------------------------
  // Access check
  // ---------------------------------------------------------------------------

  private checkAccess(namespace: string, action: "read" | "write"): void {
    const { agentId, division, permissions } = this.ctx;

    // system_admin has wildcard — bypass all checks
    if (permissions.includes("*")) return;

    const deny = (reason: string): never => {
      this.opts.onDeny?.(agentId, namespace, action, reason);
      throw new SecretAccessDeniedError(agentId, namespace, action, reason);
    };

    // --- global / providers ---
    if (namespace === "global" || namespace === "providers") {
      if (action === "read") {
        if (!permissions.includes("read_secrets_global")) {
          deny("requires read_secrets_global permission");
        }
      } else {
        if (!permissions.includes("write_secrets_global")) {
          deny("requires write_secrets_global permission");
        }
      }
      return;
    }

    // --- divisions/<code> ---
    if (namespace.startsWith("divisions/")) {
      const code = namespace.slice("divisions/".length);
      if (action === "read") {
        if (!permissions.includes("read_secrets")) {
          deny("requires read_secrets permission");
        }
        if (division !== code) {
          deny(`agent division "${division}" does not match namespace "${namespace}"`);
        }
      } else {
        if (!permissions.includes("write_secrets")) {
          deny("requires write_secrets permission");
        }
        if (division !== code) {
          deny(`agent division "${division}" does not match namespace "${namespace}"`);
        }
      }
      return;
    }

    // --- modules/<id> ---
    if (namespace.startsWith("modules/")) {
      if (action === "read") {
        if (!permissions.includes("read_secrets")) {
          deny("requires read_secrets permission");
        }
      } else {
        if (!permissions.includes("write_secrets")) {
          deny("requires write_secrets permission");
        }
      }
      return;
    }

    // Unknown namespace pattern — deny by default
    deny(`unknown namespace pattern: "${namespace}"`);
  }

  // ---------------------------------------------------------------------------
  // SecretsProvider delegation
  // ---------------------------------------------------------------------------

  async init(config: SecretsConfig): Promise<void> {
    return this.inner.init(config);
  }

  async get(namespace: string, key: string): Promise<string | null> {
    this.checkAccess(namespace, "read");
    return this.inner.get(namespace, key);
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    this.checkAccess(namespace, "write");
    return this.inner.set(namespace, key, value);
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.checkAccess(namespace, "write");
    return this.inner.delete(namespace, key);
  }

  async list(namespace: string): Promise<string[]> {
    this.checkAccess(namespace, "read");
    return this.inner.list(namespace);
  }

  async ensureNamespace(namespace: string): Promise<void> {
    // ensureNamespace is an idempotent setup call — treat as write
    this.checkAccess(namespace, "write");
    return this.inner.ensureNamespace(namespace);
  }

  async rotate(namespace: string, key: string, newValue: string): Promise<void> {
    this.checkAccess(namespace, "write");
    return this.inner.rotate(namespace, key, newValue);
  }

  async getMetadata(namespace: string, key: string): Promise<SecretMetadata | null> {
    this.checkAccess(namespace, "read");
    return this.inner.getMetadata(namespace, key);
  }
}
