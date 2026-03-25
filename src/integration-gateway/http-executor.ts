// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: HTTP Executor
 *
 * Executes HTTP requests for REST/GraphQL adapters with:
 *   - URL template parameter substitution
 *   - Auth header injection
 *   - X-SIDJUA-Gateway signature header
 *   - Timeout enforcement via AbortSignal
 *   - Response injection-pattern sanitisation
 *   - Response size limit enforcement
 */

import { SidjuaError }  from "../core/error-codes.js";
import { createLogger } from "../core/logger.js";
import type { AdapterAuth, ExecutorRequest, ExecutorResponse } from "./types.js";

const logger = createLogger("http-executor");


const DEFAULT_TIMEOUT_MS    = 30_000;
const DEFAULT_MAX_BYTES     = 100 * 1024; // 100 KB
const GATEWAY_HEADER        = "X-SIDJUA-Gateway";

/**
 * Patterns in external responses that indicate possible prompt-injection
 * attempts. These are checked AFTER the response is received and cause the
 * call to fail with IGW-008.
 */
const INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+previous\s+instructions?/i,
  /\bsystem\s*:/i,
  /you\s+are\s+now\s+/i,
  /disregard\s+(all\s+)?previous/i,
  /new\s+instructions?\s*:/i,
  /\bact\s+as\s+(a\s+)?(?:jailbreak|DAN|evil|unrestricted)/i,
];


/**
 * Replace `{paramName}` placeholders in a path template with values from
 * `params`.  Unused params are passed as query-string for GET requests.
 */
function buildUrl(
  baseUrl: string,
  pathTemplate: string,
  method: string,
  params: Record<string, unknown>,
): { url: string; body: string | undefined } {
  const usedKeys = new Set<string>();

  const resolvedPath = pathTemplate.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    usedKeys.add(key);
    const val = params[key];
    return val !== undefined ? encodeURIComponent(String(val)) : `{${key}}`;
  });

  const base = baseUrl.replace(/\/$/, "");
  const path = resolvedPath.startsWith("/") ? resolvedPath : `/${resolvedPath}`;

  const unusedParams = Object.fromEntries(
    Object.entries(params).filter(([k]) => !usedKeys.has(k)),
  );

  const isBodyMethod = ["POST", "PUT", "PATCH"].includes(method.toUpperCase());

  if (isBodyMethod) {
    return { url: `${base}${path}`, body: JSON.stringify(unusedParams) };
  }

  // GET/DELETE — append remaining params as query string
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries(unusedParams).map(([k, v]) => [k, String(v)]),
    ),
  ).toString();

  return {
    url:  qs ? `${base}${path}?${qs}` : `${base}${path}`,
    body: undefined,
  };
}


function buildAuthHeaders(
  auth: AdapterAuth | undefined,
  credentials: string | null,
): Record<string, string> {
  if (auth === undefined || auth.type === "none" || credentials === null) {
    return {};
  }

  switch (auth.type) {
    case "api_key": {
      const headerName = auth.header ?? "Authorization";
      return { [headerName]: credentials };
    }
    case "bearer":
      return { Authorization: `Bearer ${credentials}` };
    case "basic": {
      // Expect credentials as "user:password"
      const encoded = Buffer.from(credentials, "utf-8").toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    case "oauth2":
      return { Authorization: `Bearer ${credentials}` };
    case "webhook_url":
      // Webhook URL auth — credential is baked into the URL; no extra header
      return {};
    default:
      return {};
  }
}


function checkInjectionPatterns(responseText: string): void {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(responseText)) {
      throw SidjuaError.from(
        "IGW-008",
        `Response matched injection pattern: ${pattern.source}`,
      );
    }
  }
}


export class HttpExecutor {
  private readonly defaultTimeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(opts: { defaultTimeoutMs?: number; maxResponseBytes?: number } = {}) {
    this.defaultTimeoutMs  = opts.defaultTimeoutMs  ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes  = opts.maxResponseBytes  ?? DEFAULT_MAX_BYTES;
  }

  /**
   * Execute an HTTP request described by `req`.
   * Throws `SidjuaError` for governance violations (timeout, injection, size).
   */
  async execute(req: ExecutorRequest): Promise<ExecutorResponse> {
    const { adapter, action, params, credentials, requestId } = req;

    const method       = (action.method ?? "GET").toUpperCase();
    const pathTemplate = action.path ?? "/";
    const timeoutMs    = req.timeoutMs
      ?? (action.governance.timeout_seconds !== undefined
        ? action.governance.timeout_seconds * 1000
        : this.defaultTimeoutMs);

    const baseUrl = adapter.base_url ?? "";
    const { url, body } = buildUrl(baseUrl, pathTemplate, method, params);

    const authHeaders = buildAuthHeaders(adapter.auth, credentials);

    const headers: Record<string, string> = {
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      [GATEWAY_HEADER]: requestId,
      ...authHeaders,
      // Adapter-specific headers override defaults (e.g. GitHub Accept)
      ...(req.extraHeaders ?? {}),
    };

    logger.debug("http-executor", `${method} ${url}`, {
      metadata: { requestId, service: adapter.name, action: req.actionName },
    });

    const startTime = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: unknown) {
      const executionMs = Date.now() - startTime;
      if (
        e instanceof Error &&
        (e.name === "TimeoutError" || e.name === "AbortError")
      ) {
        logger.warn("http-executor", `Request timed out after ${timeoutMs}ms`, {
          metadata: { requestId, url, timeoutMs },
        });
        throw SidjuaError.from("IGW-007", `Request to '${url}' timed out after ${timeoutMs}ms`);
      }
      logger.warn("http-executor", "HTTP request failed", {
        metadata: { requestId, url, error: e instanceof Error ? e.message : String(e) },
      });
      return {
        success:     false,
        statusCode:  0,
        data:        null,
        error:       e instanceof Error ? e.message : String(e),
        executionMs,
      };
    }

    const executionMs = Date.now() - startTime;

    // Read response body (bounded)
    const responseText = await this.readBoundedResponseText(response, requestId);

    // Injection-pattern check
    checkInjectionPatterns(responseText);

    // Parse JSON if possible
    let data: unknown = responseText;
    try {
      data = JSON.parse(responseText) as unknown;
    } catch (_e) {
      // Not JSON — keep as string
    }

    const success = response.ok;
    if (!success) {
      logger.debug("http-executor", `HTTP ${response.status} from ${url}`, {
        metadata: { requestId, statusCode: response.status },
      });
    }

    return {
      success,
      statusCode:  response.status,
      data,
      ...(success ? {} : { error: `HTTP ${response.status}` }),
      executionMs,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async readBoundedResponseText(
    response: Response,
    requestId: string,
  ): Promise<string> {
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const length = parseInt(contentLength, 10);
      if (!isNaN(length) && length > this.maxResponseBytes) {
        throw SidjuaError.from(
          "IGW-009",
          `Response Content-Length ${length} exceeds limit of ${this.maxResponseBytes} bytes`,
        );
      }
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf-8") > this.maxResponseBytes) {
      logger.warn("http-executor", "Response exceeded size limit — truncating", {
        metadata: { requestId, maxBytes: this.maxResponseBytes, actualBytes: Buffer.byteLength(text, "utf-8") },
      });
      throw SidjuaError.from(
        "IGW-009",
        `Response body exceeded ${this.maxResponseBytes} bytes`,
      );
    }

    return text;
  }
}
