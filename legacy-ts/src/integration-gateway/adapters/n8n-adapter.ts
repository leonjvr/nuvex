// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: n8n Adapter
 *
 * Deterministic adapter for n8n workflow automation.
 * Actions: trigger_workflow, list_workflows, get_execution.
 *
 * Auth: API key via `X-N8N-API-KEY` header (set in adapter YAML).
 * base_url: resolved from `N8N_BASE_URL` environment variable by the loader.
 */

import { BaseHttpAdapter } from "./base-adapter.js";
import type { AdapterDefinition } from "../types.js";
import type { HttpExecutor }      from "../http-executor.js";


export class N8nAdapter extends BaseHttpAdapter {
  constructor(definition: AdapterDefinition, httpExecutor: HttpExecutor) {
    super(definition, httpExecutor);
  }

  // n8n REST API requires no additional headers beyond those set by YAML auth.
  // Environment-variable substitution for base_url is handled by the loader.
  protected override get extraHeaders(): Record<string, string> {
    return {};
  }
}
