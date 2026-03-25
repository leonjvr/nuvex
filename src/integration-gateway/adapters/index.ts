// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Adapters Public API
 */

export { BaseHttpAdapter }   from "./base-adapter.js";
export { N8nAdapter }        from "./n8n-adapter.js";
export { GithubAdapter }     from "./github-adapter.js";
export { SlackAdapter }      from "./slack-adapter.js";
export { loadAdapters, substituteEnvVars } from "./adapter-loader.js";
