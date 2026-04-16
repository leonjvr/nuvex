// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Main Service
 *
 * Orchestrates the full request lifecycle:
 *   1. Validate request fields
 *   2. Resolve route (deterministic / intelligent / blocked)
 *   3. Resolve credentials from secrets service
 *   4. Execute via HttpExecutor (deterministic path)
 *   5. Emit audit event for every outcome
 */

import { randomUUID }   from "node:crypto";
import { SidjuaError }  from "../core/error-codes.js";
import { createLogger } from "../core/logger.js";
import type { AdapterRegistry }  from "./adapter-registry.js";
import type { RouteResolver }    from "./route-resolver.js";
import type { HttpExecutor }     from "./http-executor.js";
import type { PolicyEnforcer }   from "./policy-enforcer.js";
import type { ScriptExecutor }   from "./executors/script-executor.js";
import type { CliExecutor }      from "./executors/cli-executor.js";
import type { McpBridge }        from "./executors/mcp-bridge.js";
import type { IntelligentPathResolver } from "./intelligent-path.js";
import type {
  GatewayAuditService,
  GatewaySecretsService,
  GatewayRequest,
  GatewayResponse,
  IntegrationAuditEvent,
  IntegrationConfig,
  AdapterDefinition,
  AdapterAction,
  RiskLevel,
  RouteResolution,
} from "./types.js";

const logger = createLogger("integration-gateway");


function validateRequest(request: GatewayRequest): void {
  if (!request.agent_id || request.agent_id.trim() === "") {
    throw SidjuaError.from("IGW-004", "GatewayRequest.agent_id is required");
  }
  if (!request.service || request.service.trim() === "") {
    throw SidjuaError.from("IGW-004", "GatewayRequest.service is required");
  }
  if (!request.action || request.action.trim() === "") {
    throw SidjuaError.from("IGW-004", "GatewayRequest.action is required");
  }
  if (!request.request_id || request.request_id.trim() === "") {
    throw SidjuaError.from("IGW-004", "GatewayRequest.request_id is required");
  }
  if (!request.division || request.division.trim() === "") {
    throw SidjuaError.from("IGW-004", "GatewayRequest.division is required");
  }
}


export class IntegrationGateway {
  constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly routeResolver: RouteResolver,
    private readonly httpExecutor: HttpExecutor,
    private readonly auditService: GatewayAuditService,
    private readonly secretsService: GatewaySecretsService,
    private readonly config: IntegrationConfig,
    private readonly policyEnforcer?: PolicyEnforcer,
    private readonly scriptExecutor?: ScriptExecutor,
    private readonly cliExecutor?: CliExecutor,
    private readonly mcpBridge?: McpBridge,
    private readonly intelligentPath?: IntelligentPathResolver,
  ) {}

  /**
   * Execute a gateway request end-to-end.
   * Always returns a GatewayResponse — never throws (errors become `success: false`).
   */
  async execute(request: GatewayRequest): Promise<GatewayResponse> {
    const startTime = Date.now();
    const auditId   = randomUUID();

    // 1. Validate request
    try {
      validateRequest(request);
    } catch (e: unknown) {
      const executionMs = Date.now() - startTime;
      const errorMsg = e instanceof SidjuaError ? e.message : String(e);
      await this.auditEvent({
        event_type: "integration_blocked",
        request_id: request.request_id ?? "unknown",
        agent_id:   request.agent_id   ?? "unknown",
        division:   request.division   ?? "unknown",
        service:    request.service    ?? "unknown",
        action:     request.action     ?? "unknown",
        path_used:  "deterministic",
        risk_level: "low",
        error:      errorMsg,
        execution_ms: executionMs,
      });
      return {
        success:      false,
        error:        errorMsg,
        request_id:   request.request_id ?? "unknown",
        execution_ms: executionMs,
        path_used:    "deterministic",
        audit_id:     auditId,
      };
    }

    // Emit request start event
    await this.auditEvent({
      event_type: "integration_request",
      request_id: request.request_id,
      agent_id:   request.agent_id,
      division:   request.division,
      service:    request.service,
      action:     request.action,
      path_used:  "deterministic", // refined below
      risk_level: "low",           // refined below
    });

    // 2. Resolve route
    const resolution = this.routeResolver.resolve(request.service, request.action);

    if (resolution.path === "blocked") {
      const executionMs = Date.now() - startTime;
      await this.auditEvent({
        event_type:   "integration_blocked",
        request_id:   request.request_id,
        agent_id:     request.agent_id,
        division:     request.division,
        service:      request.service,
        action:       request.action,
        path_used:    "deterministic",
        risk_level:   "low",
        ...(resolution.reason !== undefined ? { error: resolution.reason } : {}),
        execution_ms: executionMs,
      });
      logger.warn("integration-gateway", `Request blocked: ${resolution.reason}`, {
        metadata: { requestId: request.request_id, service: request.service, action: request.action },
      });
      return {
        success:      false,
        error:        resolution.reason ?? "Request blocked",
        request_id:   request.request_id,
        execution_ms: executionMs,
        path_used:    "deterministic",
        audit_id:     auditId,
      };
    }

    // 3. Intelligent path
    if (resolution.path === "intelligent") {
      if (!this.config.gateway.intelligent_path.enabled) {
        const executionMs = Date.now() - startTime;
        const reason = "Intelligent path is disabled";
        await this.auditEvent({
          event_type:   "integration_blocked",
          request_id:   request.request_id,
          agent_id:     request.agent_id,
          division:     request.division,
          service:      request.service,
          action:       request.action,
          path_used:    "intelligent",
          risk_level:   "low",
          error:        reason,
          execution_ms: executionMs,
        });
        return {
          success:      false,
          error:        reason,
          request_id:   request.request_id,
          execution_ms: executionMs,
          path_used:    "intelligent",
          audit_id:     auditId,
        };
      }
      return this.executeIntelligentPath(request, startTime, auditId);
    }

    // 4. Governance policy check (when PolicyEnforcer is wired)
    if (this.policyEnforcer !== undefined) {
      const governanceResult = await this.policyEnforcer.checkAccess(
        request.division,
        request.service,
        request.action,
        request.params,
        resolution.adapter?.base_url,
      );

      if (!governanceResult.allowed) {
        const executionMs = Date.now() - startTime;
        const reason = governanceResult.reason ?? "Access denied by governance policy";
        await this.auditEvent({
          event_type:   "integration_blocked",
          request_id:   request.request_id,
          agent_id:     request.agent_id,
          division:     request.division,
          service:      request.service,
          action:       request.action,
          path_used:    "deterministic",
          risk_level:   "low",
          error:        reason,
          execution_ms: executionMs,
        });
        logger.warn("integration-gateway", `Request blocked by policy: ${reason}`, {
          metadata: { requestId: request.request_id, service: request.service, action: request.action },
        });
        return {
          success:      false,
          error:        reason,
          request_id:   request.request_id,
          execution_ms: executionMs,
          path_used:    "deterministic",
          audit_id:     auditId,
        };
      }

      if (governanceResult.approval_required) {
        const executionMs = Date.now() - startTime;
        const approver = governanceResult.approver ?? "approver";
        const reason   = `Approval required from ${approver}`;
        await this.auditEvent({
          event_type:   "integration_approval_required",
          request_id:   request.request_id,
          agent_id:     request.agent_id,
          division:     request.division,
          service:      request.service,
          action:       request.action,
          path_used:    "deterministic",
          risk_level:   "low",
          error:        reason,
          execution_ms: executionMs,
        });
        logger.debug("integration-gateway", `Approval required for ${request.service}.${request.action}`, {
          metadata: { requestId: request.request_id, approver },
        });
        return {
          success:      false,
          error:        reason,
          request_id:   request.request_id,
          execution_ms: executionMs,
          path_used:    "deterministic",
          audit_id:     auditId,
        };
      }
    }

    // 5. Deterministic path — resolve credentials and execute
    return this.executeDeterministic(request, resolution, startTime, auditId);
  }

  // ---------------------------------------------------------------------------
  // Deterministic execution
  // ---------------------------------------------------------------------------

  private async executeDeterministic(
    request: GatewayRequest,
    resolution: RouteResolution,
    startTime: number,
    auditId: string,
  ): Promise<GatewayResponse> {
    const adapter = resolution.adapter!;
    const action  = resolution.action!;
    const riskLevel = action.governance.risk_level;

    // Non-HTTP protocols skip HTTP credential resolution and execute locally
    if (
      adapter.protocol === "local_script" ||
      adapter.protocol === "cli" ||
      adapter.protocol === "mcp"
    ) {
      return this.executeLocalProtocol(request, adapter, action, riskLevel, startTime, auditId);
    }

    // Resolve credentials
    let credentials: string | null = null;
    if (adapter.auth !== undefined && adapter.auth.type !== "none") {
      try {
        credentials = await this.resolveCredentials(adapter, request.division);
      } catch (e: unknown) {
        const executionMs = Date.now() - startTime;
        const errorMsg = e instanceof Error ? e.message : String(e);
        await this.auditEvent({
          event_type:   "integration_failure",
          request_id:   request.request_id,
          agent_id:     request.agent_id,
          division:     request.division,
          service:      request.service,
          action:       request.action,
          path_used:    "deterministic",
          risk_level:   riskLevel,
          error:        errorMsg,
          execution_ms: executionMs,
        });
        logger.warn("integration-gateway", "Credential resolution failed", {
          metadata: { requestId: request.request_id, service: request.service, error: errorMsg },
        });
        return {
          success:      false,
          error:        errorMsg,
          request_id:   request.request_id,
          execution_ms: executionMs,
          path_used:    "deterministic",
          audit_id:     auditId,
        };
      }
    }

    // Execute HTTP request
    let executorResult;
    try {
      executorResult = await this.httpExecutor.execute({
        adapter,
        action,
        actionName:  request.action,
        params:      request.params,
        credentials,
        requestId:   request.request_id,
        ...(action.governance.timeout_seconds !== undefined
          ? { timeoutMs: action.governance.timeout_seconds * 1000 }
          : {}),
      });
    } catch (e: unknown) {
      const executionMs = Date.now() - startTime;
      const errorMsg = e instanceof SidjuaError ? e.message : (e instanceof Error ? e.message : String(e));
      await this.auditEvent({
        event_type:   "integration_failure",
        request_id:   request.request_id,
        agent_id:     request.agent_id,
        division:     request.division,
        service:      request.service,
        action:       request.action,
        path_used:    "deterministic",
        risk_level:   riskLevel,
        error:        errorMsg,
        execution_ms: executionMs,
      });
      return {
        success:      false,
        error:        errorMsg,
        request_id:   request.request_id,
        execution_ms: executionMs,
        path_used:    "deterministic",
        audit_id:     auditId,
      };
    }

    const executionMs = Date.now() - startTime;
    const eventType   = executorResult.success ? "integration_success" : "integration_failure";

    await this.auditEvent({
      event_type:   eventType,
      request_id:   request.request_id,
      agent_id:     request.agent_id,
      division:     request.division,
      service:      request.service,
      action:       request.action,
      path_used:    "deterministic",
      risk_level:   riskLevel,
      status_code:  executorResult.statusCode,
      execution_ms: executionMs,
      ...(executorResult.error !== undefined ? { error: executorResult.error } : {}),
    });

    if (executorResult.success) {
      logger.debug("integration-gateway", `Success: ${request.service}.${request.action} in ${executionMs}ms`, {
        metadata: { requestId: request.request_id, statusCode: executorResult.statusCode },
      });
    } else {
      logger.warn("integration-gateway", `External call failed: ${request.service}.${request.action}`, {
        metadata: { requestId: request.request_id, statusCode: executorResult.statusCode, error: executorResult.error },
      });
    }

    return {
      success:      executorResult.success,
      status_code:  executorResult.statusCode,
      data:         executorResult.data,
      ...(executorResult.error !== undefined ? { error: executorResult.error } : {}),
      request_id:   request.request_id,
      execution_ms: executionMs,
      path_used:    "deterministic",
      audit_id:     auditId,
    };
  }

  // ---------------------------------------------------------------------------
  // Local protocol execution (local_script / cli / mcp)
  // ---------------------------------------------------------------------------

  private async executeLocalProtocol(
    request:   GatewayRequest,
    adapter:   AdapterDefinition,
    action:    AdapterAction,
    riskLevel: RiskLevel,
    startTime: number,
    auditId:   string,
  ): Promise<GatewayResponse> {
    const timeoutMs = (action.governance.timeout_seconds ?? 30) * 1000;

    try {
      let localResult: { success: boolean; data: unknown; error?: string };

      if (adapter.protocol === "local_script") {
        if (!this.scriptExecutor) {
          throw new Error("Script executor not configured for local_script protocol");
        }
        const scriptResult = await this.scriptExecutor.execute({
          script_path:   adapter.script_path ?? "",
          function_name: (action as AdapterAction & { function?: string }).function ?? "main",
          args:          request.params,
          runtime:       adapter.runtime ?? "python3",
          timeout_ms:    timeoutMs,
          request_id:    request.request_id,
        });
        localResult = {
          success: scriptResult.success,
          data:    { stdout: scriptResult.stdout, stderr: scriptResult.stderr, exit_code: scriptResult.exit_code },
          ...(scriptResult.success ? {} : { error: `Process exited with code ${scriptResult.exit_code}` }),
        };
      } else if (adapter.protocol === "cli") {
        if (!this.cliExecutor) {
          throw new Error("CLI executor not configured for cli protocol");
        }
        const actionWithCmd = action as AdapterAction & { command?: string };
        const cliResult = await this.cliExecutor.execute({
          command:    actionWithCmd.command ?? "",
          args:       Object.values(request.params).map(String),
          timeout_ms: timeoutMs,
          request_id: request.request_id,
        });
        localResult = {
          success: cliResult.success,
          data:    { stdout: cliResult.stdout, stderr: cliResult.stderr, exit_code: cliResult.exit_code },
          ...(cliResult.success ? {} : { error: `Process exited with code ${cliResult.exit_code}` }),
        };
      } else {
        // mcp
        if (!this.mcpBridge) {
          throw new Error("MCP bridge not configured for mcp protocol");
        }
        const mcpResult = await this.mcpBridge.execute({
          server_name: request.service,
          tool_name:   request.action,
          arguments:   request.params,
          request_id:  request.request_id,
          timeout_ms:  timeoutMs,
        });
        localResult = {
          success: mcpResult.success,
          data:    mcpResult.result,
          ...(mcpResult.error !== undefined ? { error: mcpResult.error } : {}),
        };
      }

      const executionMs = Date.now() - startTime;
      const eventType   = localResult.success ? "integration_success" : "integration_failure";

      await this.auditEvent({
        event_type:   eventType,
        request_id:   request.request_id,
        agent_id:     request.agent_id,
        division:     request.division,
        service:      request.service,
        action:       request.action,
        path_used:    "deterministic",
        risk_level:   riskLevel,
        execution_ms: executionMs,
        ...(localResult.error !== undefined ? { error: localResult.error } : {}),
      });

      return {
        success:      localResult.success,
        data:         localResult.data,
        ...(localResult.error !== undefined ? { error: localResult.error } : {}),
        request_id:   request.request_id,
        execution_ms: executionMs,
        path_used:    "deterministic",
        audit_id:     auditId,
      };
    } catch (e: unknown) {
      const executionMs = Date.now() - startTime;
      const errorMsg    = e instanceof Error ? e.message : String(e);

      await this.auditEvent({
        event_type:   "integration_failure",
        request_id:   request.request_id,
        agent_id:     request.agent_id,
        division:     request.division,
        service:      request.service,
        action:       request.action,
        path_used:    "deterministic",
        risk_level:   riskLevel,
        error:        errorMsg,
        execution_ms: executionMs,
      });

      logger.warn("integration-gateway", `Local protocol execution failed: ${errorMsg}`, {
        metadata: { requestId: request.request_id, service: request.service, protocol: adapter.protocol },
      });

      return {
        success:      false,
        error:        errorMsg,
        request_id:   request.request_id,
        execution_ms: executionMs,
        path_used:    "deterministic",
        audit_id:     auditId,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Intelligent path execution
  // ---------------------------------------------------------------------------

  private async executeIntelligentPath(
    request:   GatewayRequest,
    startTime: number,
    auditId:   string,
  ): Promise<GatewayResponse> {
    if (this.intelligentPath === undefined) {
      const executionMs = Date.now() - startTime;
      const error = "Intelligent path resolver not configured";
      await this.auditEvent({
        event_type:   "integration_failure",
        request_id:   request.request_id,
        agent_id:     request.agent_id,
        division:     request.division,
        service:      request.service,
        action:       request.action,
        path_used:    "intelligent",
        risk_level:   "low",
        error,
        execution_ms: executionMs,
      });
      return {
        success:      false,
        error,
        request_id:   request.request_id,
        execution_ms: executionMs,
        path_used:    "intelligent",
        audit_id:     auditId,
      };
    }

    const result = await this.intelligentPath.resolve(
      request.service,
      request.action,
      request.params,
    );

    if (!result.success) {
      const executionMs = Date.now() - startTime;
      const errorMsg = result.error ?? "Intelligent path failed";
      await this.auditEvent({
        event_type:   "integration_failure",
        request_id:   request.request_id,
        agent_id:     request.agent_id,
        division:     request.division,
        service:      request.service,
        action:       request.action,
        path_used:    "intelligent",
        risk_level:   "low",
        error:        errorMsg,
        execution_ms: executionMs,
      });
      return {
        success:      false,
        error:        errorMsg,
        request_id:   request.request_id,
        execution_ms: executionMs,
        path_used:    "intelligent",
        audit_id:     auditId,
      };
    }

    // Resolve credentials separately (never passed to LLM)
    const credHeader = await this.resolveCredentialsForIntelligent(
      request.service,
      request.division,
    );

    const url    = result.url!;
    const method = result.method!;
    const headers: Record<string, string> = {
      "Content-Type":    "application/json",
      "Accept":          "application/json",
      "X-SIDJUA-Gateway": request.request_id,
      ...(credHeader ?? {}),
      ...(result.headers ?? {}),
    };

    let httpResponse: Response;
    try {
      const bodyStr = result.body !== undefined ? JSON.stringify(result.body) : undefined;
      httpResponse = await fetch(url, {
        method,
        headers,
        ...(bodyStr !== undefined ? { body: bodyStr } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: unknown) {
      const executionMs = Date.now() - startTime;
      const errorMsg = e instanceof Error ? e.message : String(e);
      await this.auditEvent({
        event_type:   "integration_failure",
        request_id:   request.request_id,
        agent_id:     request.agent_id,
        division:     request.division,
        service:      request.service,
        action:       request.action,
        path_used:    "intelligent",
        risk_level:   "low",
        error:        errorMsg,
        execution_ms: executionMs,
      });
      return {
        success:      false,
        error:        errorMsg,
        request_id:   request.request_id,
        execution_ms: executionMs,
        path_used:    "intelligent",
        audit_id:     auditId,
      };
    }

    const executionMs  = Date.now() - startTime;
    const responseText = await httpResponse.text();
    let data: unknown = responseText;
    try {
      data = JSON.parse(responseText) as unknown;
    } catch (_e) {
      // keep as string
    }

    const success = httpResponse.ok;
    await this.auditEvent({
      event_type:   success ? "integration_success" : "integration_failure",
      request_id:   request.request_id,
      agent_id:     request.agent_id,
      division:     request.division,
      service:      request.service,
      action:       request.action,
      path_used:    "intelligent",
      risk_level:   "low",
      status_code:  httpResponse.status,
      execution_ms: executionMs,
      ...(!success ? { error: `HTTP ${httpResponse.status}` } : {}),
    });

    return {
      success,
      status_code:  httpResponse.status,
      data,
      ...(!success ? { error: `HTTP ${httpResponse.status}` } : {}),
      request_id:   request.request_id,
      execution_ms: executionMs,
      path_used:    "intelligent",
      audit_id:     auditId,
    };
  }

  /**
   * Look up an API credential for the intelligent path by service + division.
   * Returns a map suitable for merging into request headers, or null if none found.
   */
  private async resolveCredentialsForIntelligent(
    service: string,
    division: string,
  ): Promise<Record<string, string> | null> {
    const secretRef = `${service}_api_key`;
    const divKey    = await this.secretsService.get(`divisions/${division}`, secretRef);
    if (divKey !== null) return { Authorization: `Bearer ${divKey}` };
    const globalKey = await this.secretsService.get("global", secretRef);
    if (globalKey !== null) return { Authorization: `Bearer ${globalKey}` };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Credential resolution
  // ---------------------------------------------------------------------------

  private async resolveCredentials(
    adapter: AdapterDefinition,
    division: string,
  ): Promise<string | null> {
    if (adapter.auth === undefined || adapter.auth.type === "none") {
      return null;
    }

    const secretRef = adapter.auth.secret_ref;

    // Try division-scoped first, then global
    const divisionKey = await this.secretsService.get(`divisions/${division}`, secretRef);
    if (divisionKey !== null) return divisionKey;

    const globalKey = await this.secretsService.get("global", secretRef);
    if (globalKey !== null) return globalKey;

    throw SidjuaError.from(
      "IGW-006",
      `No credential found for '${secretRef}' in division '${division}' or global namespace`,
    );
  }

  // ---------------------------------------------------------------------------
  // Audit helpers
  // ---------------------------------------------------------------------------

  private async auditEvent(event: Omit<IntegrationAuditEvent, "timestamp">): Promise<void> {
    try {
      await this.auditService.logIntegrationEvent({
        ...event,
        timestamp: new Date().toISOString(),
      });
    } catch (e: unknown) {
      logger.warn("integration-gateway", "Failed to emit audit event", {
        metadata: { error: e instanceof Error ? e.message : String(e), eventType: event.event_type },
      });
    }
  }
}
