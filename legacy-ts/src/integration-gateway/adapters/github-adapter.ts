// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: GitHub Adapter
 *
 * Deterministic adapter for the GitHub REST API.
 * Actions: list_issues, create_issue, create_release, list_pulls.
 *
 * Auth: Bearer token via `github-token` secret.
 * Extra headers required by the GitHub API:
 *   Accept: application/vnd.github+json
 *   X-GitHub-Api-Version: 2022-11-28
 */

import { BaseHttpAdapter } from "./base-adapter.js";
import type { AdapterDefinition } from "../types.js";
import type { HttpExecutor }      from "../http-executor.js";


export class GithubAdapter extends BaseHttpAdapter {
  constructor(definition: AdapterDefinition, httpExecutor: HttpExecutor) {
    super(definition, httpExecutor);
  }

  protected override get extraHeaders(): Record<string, string> {
    return {
      "Accept":              "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }
}
