// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Slack Adapter
 *
 * Deterministic adapter for the Slack Web API.
 * Actions: post_message, list_channels, upload_file.
 *
 * Auth: Bearer token (bot token) via `slack-bot-token` secret.
 * Slack's API expects `Content-Type: application/json; charset=utf-8`
 * for JSON-body endpoints.
 */

import { BaseHttpAdapter } from "./base-adapter.js";
import type { AdapterDefinition } from "../types.js";
import type { HttpExecutor }      from "../http-executor.js";


export class SlackAdapter extends BaseHttpAdapter {
  constructor(definition: AdapterDefinition, httpExecutor: HttpExecutor) {
    super(definition, httpExecutor);
  }

  protected override get extraHeaders(): Record<string, string> {
    return {
      // Slack expects charset declaration for JSON bodies
      "Content-Type": "application/json; charset=utf-8",
    };
  }
}
