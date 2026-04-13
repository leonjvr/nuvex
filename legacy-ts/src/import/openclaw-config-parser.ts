// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — OpenClaw Config Parser
 *
 * Parses ~/.openclaw/openclaw.json (JSON5 superset) without any external
 * JSON5 library.  A lightweight sanitizer strips JSON5-specific syntax so the
 * result can be fed directly to JSON.parse().
 *
 * Supported JSON5 extensions handled here:
 *   - Single-line comments  //
 *   - Multi-line comments   /* … *\/
 *   - Trailing commas before } and ]
 *   - Single-quoted strings (converted to double-quoted)
 *   - Unquoted object keys  (converted to quoted)
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { OpenClawConfig } from "./openclaw-types.js";


/**
 * Strip JSON5-specific syntax from a raw string and return valid JSON.
 * Best-effort: handles the constructs documented by the OpenClaw format.
 */
export function sanitizeJson5(input: string): string {
  let out = input;

  // 1. Remove multi-line comments /* ... */  (non-greedy, dotAll)
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");

  // 2. Remove single-line comments // ... (not inside strings)
  //    Split on lines to avoid clobbering URLs ("https://")
  out = out
    .split("\n")
    .map((line) => {
      // Remove // comment that is NOT inside a string.
      // Simple heuristic: find // that is preceded by an even number of " chars.
      let inString = false;
      let escaped  = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (escaped)              { escaped = false; continue; }
        if (ch === "\\")          { escaped = true;  continue; }
        if (ch === '"' && !inString) { inString = true;  continue; }
        if (ch === '"' &&  inString) { inString = false; continue; }
        if (!inString && ch === "/" && line[i + 1] === "/") {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");

  // 3. Replace single-quoted strings with double-quoted strings.
  //    Handles escaped single quotes within the string.
  out = out.replace(/'((?:[^'\\]|\\.)*)'/g, (_match, inner: string) => {
    // Escape backslashes first, then unescape \' and escape any " inside.
    // Order matters: backslashes must be doubled before quote handling to
    // prevent a trailing backslash from consuming the added escape character.
    const fixed = inner
      .replace(/\\\\/g, "\\\\")  // escape literal backslashes first
      .replace(/\\'/g, "'")       // unescape single quotes
      .replace(/"/g, '\\"');      // escape double quotes
    return `"${fixed}"`;
  });

  // 4. Quote unquoted object keys  { foo: ... }  →  { "foo": ... }
  //    Matches a key that is a bare identifier immediately before ":"
  out = out.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*):/g, '$1"$2"$3:');

  // 5. Remove trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, "$1");

  return out;
}


function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}


/**
 * Read an openclaw.json (JSON5) file and return a typed OpenClawConfig.
 * Unknown top-level keys are silently ignored.
 * Throws descriptive errors for file-not-found or parse failures.
 */
export async function parseOpenClawConfig(configPath: string): Promise<OpenClawConfig> {
  if (!existsSync(configPath)) {
    throw new Error(
      `OpenClaw config not found at ${configPath}. ` +
      `Use --config to specify path.`,
    );
  }

  const raw = await readFile(configPath, "utf-8");
  let sanitized: string;
  try {
    sanitized = sanitizeJson5(raw);
  } catch (err) {
    throw new Error(`Could not sanitize openclaw.json: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitized) as unknown;
  } catch (err) {
    throw new Error(
      `Could not parse openclaw.json: ${String(err)}. ` +
      `Is this a valid OpenClaw config?`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("openclaw.json must be a JSON object at the top level.");
  }

  return extractConfig(parsed);
}


function extractConfig(raw: Record<string, unknown>): OpenClawConfig {
  const config: OpenClawConfig = {};

  // identity
  const id = asRecord(raw["identity"]);
  if (id) {
    config.identity = {};
    if (typeof id["name"]  === "string") config.identity.name  = id["name"];
    if (typeof id["theme"] === "string") config.identity.theme = id["theme"];
    if (typeof id["emoji"] === "string") config.identity.emoji = id["emoji"];
  }

  // agent
  const agRaw = asRecord(raw["agent"]);
  if (agRaw) {
    config.agent = {};
    if (typeof agRaw["workspace"] === "string") {
      config.agent.workspace = agRaw["workspace"];
    }
    const mdRaw = asRecord(agRaw["model"]);
    if (mdRaw) {
      config.agent.model = {};
      if (typeof mdRaw["primary"]  === "string") config.agent.model.primary  = mdRaw["primary"];
      if (typeof mdRaw["fallback"] === "string") config.agent.model.fallback = mdRaw["fallback"];
    }
  }

  // channels
  const chRaw = asRecord(raw["channels"]);
  if (chRaw) {
    config.channels = {};
    if (isRecord(chRaw["whatsapp"])) {
      config.channels.whatsapp = chRaw["whatsapp"] as { allowFrom?: string[]; groups?: Record<string, unknown> };
    }
    if (isRecord(chRaw["discord"]))  config.channels.discord  = chRaw["discord"]  as { guilds?: Record<string, unknown> };
    if (isRecord(chRaw["telegram"])) config.channels.telegram = chRaw["telegram"] as { allowFrom?: Array<string | number> };
    if (isRecord(chRaw["slack"]))    config.channels.slack    = chRaw["slack"] as Record<string, unknown>;
    if (isRecord(chRaw["signal"]))   config.channels.signal   = chRaw["signal"] as Record<string, unknown>;
  }

  // skills
  const skRaw = asRecord(raw["skills"]);
  if (skRaw) {
    config.skills = {};
    if (isRecord(skRaw["entries"])) {
      const entries: Record<string, { enabled?: boolean; env?: Record<string, string>; apiKey?: string }> = {};
      for (const [k, v] of Object.entries(skRaw["entries"])) {
        if (isRecord(v)) {
          entries[k] = {};
          if (typeof v["enabled"] === "boolean") entries[k]!.enabled = v["enabled"];
          if (typeof v["apiKey"]  === "string")  entries[k]!.apiKey  = v["apiKey"];
          if (isRecord(v["env"])) {
            entries[k]!.env = Object.fromEntries(
              Object.entries(v["env"]).filter(([, val]) => typeof val === "string") as [string, string][],
            );
          }
        }
      }
      config.skills.entries = entries;
    }
    if (Array.isArray(skRaw["allowBundled"])) {
      config.skills.allowBundled = (skRaw["allowBundled"] as unknown[]).filter((s): s is string => typeof s === "string");
    }
    const ldRaw = asRecord(skRaw["load"]);
    if (ldRaw && Array.isArray(ldRaw["extraDirs"])) {
      config.skills.load = {
        extraDirs: (ldRaw["extraDirs"] as unknown[]).filter((s): s is string => typeof s === "string"),
      };
    }
  }

  // env
  if (isRecord(raw["env"])) {
    config.env = raw["env"] as Record<string, string | Record<string, string>>;
  }

  // auth
  const authRaw = asRecord(raw["auth"]);
  if (authRaw) {
    config.auth = {};
    if (isRecord(authRaw["profiles"])) {
      const profiles: Record<string, { provider?: string; mode?: string; email?: string }> = {};
      for (const [k, v] of Object.entries(authRaw["profiles"])) {
        if (isRecord(v)) {
          profiles[k] = {};
          if (typeof v["provider"] === "string") profiles[k]!.provider = v["provider"];
          if (typeof v["mode"]     === "string") profiles[k]!.mode     = v["mode"];
          if (typeof v["email"]    === "string") profiles[k]!.email    = v["email"];
        }
      }
      config.auth.profiles = profiles;
    }
    if (isRecord(authRaw["order"])) {
      config.auth.order = Object.fromEntries(
        Object.entries(authRaw["order"]).map(([k, v]) => [k, Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []]),
      );
    }
  }

  return config;
}
