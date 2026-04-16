// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Lightweight OpenAPI 3.x Parser
 *
 * Extracts the information the intelligent path needs from an OpenAPI 3.x
 * spec (JSON or YAML):
 *   - API title + version
 *   - Base URL (servers[0].url)
 *   - Security schemes
 *   - Endpoints (path, method, parameters, request body, responses)
 *
 * Does NOT validate the spec against the full OpenAPI schema — we only need
 * the structural information required to prompt an LLM.
 */

import { parse as parseYaml } from "yaml";


export interface ParsedParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  type: string;
  description?: string;
}

export interface ParsedEndpoint {
  path: string;
  method: string;
  operation_id?: string;
  summary?: string;
  parameters: ParsedParameter[];
  request_body?: {
    content_type: string;
    schema: Record<string, unknown>;
    required: boolean;
  };
  responses: Record<string, { description: string }>;
  security: string[];
}

export interface ParsedSpec {
  title: string;
  version: string;
  base_url: string;
  auth_schemes: Record<string, { type: string; name?: string; in?: string }>;
  endpoints: ParsedEndpoint[];
}


const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/**
 * Parse an OpenAPI 3.x spec (JSON or YAML string) into a structured
 * `ParsedSpec`. Missing optional fields default to sensible values.
 *
 * @throws SyntaxError / Error when the content cannot be parsed at all.
 */
export function parseOpenApiSpec(specContent: string): ParsedSpec {
  const trimmed = specContent.trim();
  let raw: Record<string, unknown>;
  if (trimmed.startsWith("{")) {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } else {
    raw = parseYaml(trimmed) as Record<string, unknown>;
  }

  // ------------------------------------------------------------------
  // Info block
  // ------------------------------------------------------------------
  const info = (raw["info"] as Record<string, unknown> | undefined) ?? {};
  const title   = String(info["title"]   ?? "Unknown API");
  const version = String(info["version"] ?? "0.0.0");

  // ------------------------------------------------------------------
  // Base URL
  // ------------------------------------------------------------------
  const servers = (raw["servers"] as Array<Record<string, unknown>> | undefined) ?? [];
  const base_url = servers.length > 0 ? String(servers[0]!["url"] ?? "") : "";

  // ------------------------------------------------------------------
  // Auth schemes
  // ------------------------------------------------------------------
  const components = (raw["components"] as Record<string, unknown> | undefined) ?? {};
  const securitySchemes =
    (components["securitySchemes"] as Record<string, unknown> | undefined) ?? {};

  const auth_schemes: Record<string, { type: string; name?: string; in?: string }> = {};
  for (const [schemeName, schemeRaw] of Object.entries(securitySchemes)) {
    const s = schemeRaw as Record<string, unknown>;
    const entry: { type: string; name?: string; in?: string } = {
      type: String(s["type"] ?? "unknown"),
    };
    if (s["name"] !== undefined) entry.name = String(s["name"]);
    if (s["in"]   !== undefined) entry.in   = String(s["in"]);
    auth_schemes[schemeName] = entry;
  }

  // ------------------------------------------------------------------
  // Endpoints
  // ------------------------------------------------------------------
  const paths = (raw["paths"] as Record<string, unknown> | undefined) ?? {};
  const endpoints: ParsedEndpoint[] = [];

  for (const [path, pathItemRaw] of Object.entries(paths)) {
    if (pathItemRaw === null || typeof pathItemRaw !== "object") continue;
    const pathItem = pathItemRaw as Record<string, unknown>;

    for (const method of HTTP_METHODS) {
      const operationRaw = pathItem[method];
      if (operationRaw === null || typeof operationRaw !== "object") continue;
      const op = operationRaw as Record<string, unknown>;

      // Parameters
      const rawParams =
        (op["parameters"] as Array<Record<string, unknown>> | undefined) ?? [];
      const parameters: ParsedParameter[] = rawParams.map((p) => {
        const schema = (p["schema"] as Record<string, unknown> | undefined) ?? {};
        const param: ParsedParameter = {
          name:     String(p["name"] ?? ""),
          in:       (p["in"] as ParsedParameter["in"]) ?? "query",
          required: Boolean(p["required"] ?? false),
          type:     String(schema["type"] ?? "string"),
        };
        if (p["description"] !== undefined) {
          param.description = String(p["description"]);
        }
        return param;
      });

      // Request body
      let request_body: ParsedEndpoint["request_body"] | undefined;
      const rawBody =
        op["requestBody"] as Record<string, unknown> | undefined;
      if (rawBody !== undefined) {
        const content =
          (rawBody["content"] as Record<string, unknown> | undefined) ?? {};
        const contentType = Object.keys(content)[0] ?? "application/json";
        const mediaObj =
          (content[contentType] as Record<string, unknown> | undefined) ?? {};
        request_body = {
          content_type: contentType,
          schema:       (mediaObj["schema"] as Record<string, unknown> | undefined) ?? {},
          required:     Boolean(rawBody["required"] ?? false),
        };
      }

      // Responses
      const rawResponses =
        (op["responses"] as Record<string, unknown> | undefined) ?? {};
      const responses: Record<string, { description: string }> = {};
      for (const [code, respRaw] of Object.entries(rawResponses)) {
        const r = respRaw as Record<string, unknown>;
        responses[code] = { description: String(r["description"] ?? "") };
      }

      // Security (flatten array of { schemeName: [] } objects)
      const rawSecurity =
        (op["security"] as Array<Record<string, unknown>> | undefined) ?? [];
      const security = rawSecurity.flatMap((s) => Object.keys(s));

      const endpoint: ParsedEndpoint = {
        path,
        method: method.toUpperCase(),
        parameters,
        responses,
        security,
      };
      if (op["operationId"] !== undefined) {
        endpoint.operation_id = String(op["operationId"]);
      }
      if (op["summary"] !== undefined) {
        endpoint.summary = String(op["summary"]);
      }
      if (request_body !== undefined) {
        endpoint.request_body = request_body;
      }

      endpoints.push(endpoint);
    }
  }

  return { title, version, base_url, auth_schemes, endpoints };
}
