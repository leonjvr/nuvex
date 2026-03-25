// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Intelligent Path
 *
 * When an agent needs an API that has no pre-built adapter, the intelligent
 * path uses an LLM (Haiku by default) to:
 *   1. Parse the API's OpenAPI spec from the schema store.
 *   2. Select the correct endpoint for the agent's intent.
 *   3. Construct the request (URL, method, headers, body).
 *   4. Validate the constructed request against the spec.
 *   5. Return the result for execution via raw fetch in the gateway.
 *
 * SECURITY: Credentials NEVER appear in the LLM prompt.
 *           Only auth type / scheme names are included.
 */

import { createLogger }    from "../core/logger.js";
import { parseOpenApiSpec } from "./openapi-parser.js";
import type { SchemaStore } from "./schema-store.js";
import type { IntegrationConfig } from "./types.js";
import type { ProviderCallInput, ProviderCallResponse, ProviderName } from "../types/provider.js";

const logger = createLogger("intelligent-path");


/**
 * Duck-typed subset of ProviderRegistry needed by IntelligentPathResolver.
 * Defined here so tests can inject a simple mock without importing the full
 * ProviderRegistry.
 */
export interface ProviderRegistryLike {
  call(
    input: ProviderCallInput,
    options?: { provider?: string },
  ): Promise<ProviderCallResponse>;
}

export interface IntelligentPathResult {
  success: boolean;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query_params?: Record<string, unknown>;
  auth_scheme?: string;
  error?: string;
}

interface ConstructedRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  query_params?: Record<string, unknown>;
}

type ParsedSpec = ReturnType<typeof parseOpenApiSpec>;


export class IntelligentPathResolver {
  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly providerRegistry: ProviderRegistryLike,
    private readonly config: IntegrationConfig["gateway"]["intelligent_path"],
  ) {}

  /**
   * Resolve an agent's intent against a discovered API schema.
   *
   * @param serviceName  - The API service to call (must have a schema stored).
   * @param agentIntent  - Natural-language description of what the agent wants.
   * @param params       - Concrete parameter values available to the agent.
   */
  async resolve(
    serviceName: string,
    agentIntent: string,
    params: Record<string, unknown>,
  ): Promise<IntelligentPathResult> {
    // 1. Get schema
    const schema = await this.schemaStore.getSchema(serviceName);
    if (schema === null) {
      return {
        success: false,
        error:   `No API schema found for service '${serviceName}'`,
      };
    }

    // 2. Parse spec
    let parsed: ParsedSpec;
    try {
      parsed = parseOpenApiSpec(schema.spec_content);
    } catch (e: unknown) {
      return {
        success: false,
        error:   `Failed to parse API spec: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 3. Build prompt — credentials are NOT included
    const prompt = this.buildPrompt(parsed, agentIntent, params);

    // 4. Call LLM
    let llmResponse: string;
    try {
      llmResponse = await this.callLlm(prompt);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("intelligent-path", `LLM call failed for '${serviceName}': ${msg}`, {
        metadata: { service: serviceName },
      });
      await this.schemaStore.recordUsage(serviceName, false);
      return { success: false, error: `LLM call failed: ${msg}` };
    }

    // 5. Parse LLM response → structured request
    let constructedRequest: ConstructedRequest;
    try {
      constructedRequest = this.parseLlmResponse(llmResponse);
    } catch (e: unknown) {
      await this.schemaStore.recordUsage(serviceName, false);
      return {
        success: false,
        error:   `Failed to parse LLM response: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 6. Validate against spec
    const validationErrors = this.validateAgainstSpec(constructedRequest, parsed);
    if (validationErrors.length > 0) {
      await this.schemaStore.recordUsage(serviceName, false);
      return {
        success: false,
        error:   `Request validation failed: ${validationErrors.join(", ")}`,
      };
    }

    // 7. Record success
    await this.schemaStore.recordUsage(serviceName, true);

    // Determine auth scheme from spec (name only, not the credential)
    const authSchemes = Object.keys(parsed.auth_schemes);

    const result: IntelligentPathResult = {
      success:     true,
      url:         `${parsed.base_url}${constructedRequest.path}`,
      method:      constructedRequest.method,
      headers:     constructedRequest.headers,
      ...(authSchemes.length > 0 ? { auth_scheme: authSchemes[0] } : {}),
    };
    if (constructedRequest.body      !== undefined) result.body        = constructedRequest.body;
    if (constructedRequest.query_params !== undefined) result.query_params = constructedRequest.query_params;

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the LLM prompt.
   *
   * SECURITY: `params` contains runtime values supplied by the agent —
   * never credentials. Credentials are resolved separately in the gateway
   * AFTER this method returns and are never added to the prompt.
   */
  private buildPrompt(
    spec: ParsedSpec,
    intent: string,
    params: Record<string, unknown>,
  ): string {
    const endpointList = spec.endpoints
      .map(
        (e) =>
          `${e.method.toUpperCase()} ${e.path} — ${e.summary ?? e.operation_id ?? "no description"}`,
      )
      .join("\n");

    return `You are an API request constructor. Given the following API specification and user intent, select the correct endpoint and construct the request.

API: ${spec.title} v${spec.version}
Base URL: ${spec.base_url}

Available endpoints:
${endpointList}

User intent: ${intent}
Available parameters: ${JSON.stringify(params)}

Respond with ONLY a JSON object:
{
  "path": "/selected/endpoint/{with_params}",
  "method": "POST",
  "headers": {"Content-Type": "application/json"},
  "body": {},
  "query_params": {}
}`;
  }

  /** Call the LLM via the existing provider system. */
  private async callLlm(prompt: string): Promise<string> {
    const response = await this.providerRegistry.call({
      agentId:      "integration-gateway",
      divisionCode: "system",
      provider:     this.config.llm_provider as ProviderName,
      model:        this.config.llm_model,
      messages:     [{ role: "user", content: prompt }],
      maxTokens:    this.config.max_tokens_per_discovery,
      temperature:  0,
    });
    return response.content;
  }

  /** Extract and validate the JSON from the LLM response. */
  private parseLlmResponse(response: string): ConstructedRequest {
    let text = response.trim();

    // Strip markdown code fences if present
    const jsonBlock = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (jsonBlock !== null) {
      text = jsonBlock[1]!.trim();
    }

    // Find the outermost JSON object
    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("No JSON object found in LLM response");
    }

    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

    if (typeof parsed["path"]   !== "string") throw new Error("LLM response missing 'path'");
    if (typeof parsed["method"] !== "string") throw new Error("LLM response missing 'method'");

    const result: ConstructedRequest = {
      path:    parsed["path"] as string,
      method:  (parsed["method"] as string).toUpperCase(),
      headers: (parsed["headers"] as Record<string, string> | undefined) ?? {},
    };
    if (parsed["body"]         !== undefined) result.body         = parsed["body"];
    if (parsed["query_params"] !== undefined &&
        typeof parsed["query_params"] === "object") {
      result.query_params = parsed["query_params"] as Record<string, unknown>;
    }

    return result;
  }

  /**
   * Validate the constructed request against the parsed spec.
   * Returns an array of human-readable error strings (empty = valid).
   */
  private validateAgainstSpec(
    request: ConstructedRequest,
    spec: ParsedSpec,
  ): string[] {
    const errors: string[] = [];

    // Find matching endpoint (path params converted to regex)
    const matchingEndpoint = spec.endpoints.find((e) => {
      if (e.method !== request.method) return false;
      const pattern = e.path.replace(/\{[^}]+\}/g, "[^/]+");
      return new RegExp(`^${pattern}$`).test(request.path);
    });

    if (matchingEndpoint === undefined) {
      errors.push(`Endpoint ${request.method} ${request.path} not found in spec`);
      return errors; // no point checking further
    }

    // Check required non-path parameters
    const suppliedKeys = new Set([
      ...Object.keys(request.headers ?? {}),
      ...Object.keys(request.query_params ?? {}),
      ...(request.body !== null && typeof request.body === "object"
        ? Object.keys(request.body as object)
        : []),
    ]);

    for (const param of matchingEndpoint.parameters) {
      if (param.required && param.in !== "path" && !suppliedKeys.has(param.name)) {
        errors.push(`Required parameter '${param.name}' (${param.in}) missing`);
      }
    }

    return errors;
  }
}
