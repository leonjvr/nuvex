// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Base HTTP Adapter
 *
 * Abstract base class for deterministic HTTP adapters.  Wraps an
 * `AdapterDefinition` (loaded from YAML) and delegates execution to the
 * existing `HttpExecutor`.
 *
 * Subclasses override `extraHeaders` to inject adapter-specific HTTP headers
 * (e.g. GitHub's `Accept: application/vnd.github+json`).
 */

import type { AdapterAction, AdapterDefinition, ExecutorRequest } from "../types.js";
import type { HttpExecutor }  from "../http-executor.js";
import type { ExecutorResponse } from "../types.js";

export { ExecutorResponse };


export abstract class BaseHttpAdapter {
  constructor(
    protected readonly definition: AdapterDefinition,
    protected readonly httpExecutor: HttpExecutor,
  ) {}

  /** Service name (from AdapterDefinition). */
  get name(): string {
    return this.definition.name;
  }

  /** All actions defined for this adapter. */
  get actions(): Record<string, AdapterAction> {
    return this.definition.actions;
  }

  /**
   * Adapter-specific HTTP headers merged into every request AFTER auth headers.
   * Override in subclasses to add e.g. `Accept` or API version headers.
   */
  protected get extraHeaders(): Record<string, string> {
    return {};
  }

  /** True if the adapter has a registered action with this name. */
  hasAction(action: string): boolean {
    return action in this.definition.actions;
  }

  /** Return the AdapterAction definition, or undefined if not found. */
  getAction(action: string): AdapterAction | undefined {
    return this.definition.actions[action];
  }

  /**
   * Build the full URL for `action` with `params` substituted into path
   * template placeholders.  Returns the URL string only (no query/body split).
   *
   * Throws if the adapter has no `base_url` or the action has no `path`.
   */
  buildUrl(action: AdapterAction, params: Record<string, unknown>): string {
    if (!this.definition.base_url || !action.path) {
      throw new Error(`Adapter '${this.name}' requires base_url and action.path`);
    }

    const base = this.definition.base_url.replace(/\/$/, "");
    const resolvedPath = action.path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
      const val = params[key];
      return val !== undefined ? encodeURIComponent(String(val)) : `{${key}}`;
    });
    const path = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;
    return `${base}${path}`;
  }

  /**
   * Validate that `params` satisfies the action's parameter schema.
   * Returns an array of error strings (empty = valid).
   */
  validateParams(action: AdapterAction, params: Record<string, unknown>): string[] {
    const errors: string[] = [];
    if (!action.params) return errors;

    for (const [name, spec] of Object.entries(action.params)) {
      if (spec.required && !(name in params)) {
        errors.push(`Missing required parameter: ${name}`);
        continue;
      }
      if (name in params && spec.type) {
        const actual = typeof params[name];
        if (spec.type === "string" && actual !== "string") {
          errors.push(`Parameter '${name}': expected string, got ${actual}`);
        } else if (spec.type === "object" && actual !== "object") {
          errors.push(`Parameter '${name}': expected object, got ${actual}`);
        } else if (spec.type === "number" && actual !== "number") {
          errors.push(`Parameter '${name}': expected number, got ${actual}`);
        }
      }
    }
    return errors;
  }

  /**
   * Execute `action` through the `HttpExecutor`.
   *
   * @param action      Action name
   * @param params      Request parameters (path + body/query)
   * @param credentials Raw credential value (API key, bearer token, etc.)
   *                    or null for public endpoints
   * @param requestId   Correlation ID propagated to audit + gateway header
   */
  async execute(
    action: string,
    params: Record<string, unknown>,
    credentials: string | null,
    requestId: string,
  ): Promise<{ status: number; data: unknown }> {
    const actionDef = this.getAction(action);
    if (!actionDef) {
      throw new Error(`Unknown action '${action}' for adapter '${this.name}'`);
    }

    const validationErrors = this.validateParams(actionDef, params);
    if (validationErrors.length > 0) {
      throw new Error(`Parameter validation failed: ${validationErrors.join(", ")}`);
    }

    const extra = this.extraHeaders;
    const req: ExecutorRequest = {
      adapter:    this.definition,
      action:     actionDef,
      actionName: action,
      params,
      credentials,
      requestId,
      ...(Object.keys(extra).length > 0    ? { extraHeaders: extra }           : {}),
      ...(actionDef.governance.timeout_seconds !== undefined
        ? { timeoutMs: actionDef.governance.timeout_seconds * 1000 }
        : {}),
    };

    const result = await this.httpExecutor.execute(req);
    return { status: result.statusCode, data: result.data };
  }
}
