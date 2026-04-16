// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.7: Tool Action Resolver
 *
 * Translates generic agent intents to platform-specific commands and
 * produces a ToolAction ready for adapter execution.
 */

import type { ToolAction, PlatformType } from "./types.js";


/**
 * Maps intent → { platform → command template }.
 * Template variables: {path}, {src}, {dst}
 */
const UNIX_PLATFORMS: ReadonlySet<PlatformType> = new Set<PlatformType>([
  "macos",
  "ubuntu",
]);

const WINDOWS_PLATFORMS: ReadonlySet<PlatformType> = new Set<PlatformType>([
  "windows-11",
  "windows-10",
]);

type PlatformFamily = "unix" | "windows";

interface IntentTranslation {
  unix: string;
  windows: string;
}

const TRANSLATION_TABLE = new Map<string, IntentTranslation>([
  [
    "create_directory",
    {
      unix: "mkdir -p {path}",
      windows: "New-Item -ItemType Directory -Force -Path '{path}'",
    },
  ],
  [
    "list_files",
    {
      unix: "ls -la {path}",
      windows: "Get-ChildItem '{path}' | Format-Table",
    },
  ],
  [
    "read_file",
    {
      unix: "cat {path}",
      windows: "Get-Content '{path}'",
    },
  ],
  [
    "copy_file",
    {
      unix: "cp {src} {dst}",
      windows: "Copy-Item '{src}' '{dst}'",
    },
  ],
  [
    "move_file",
    {
      unix: "mv {src} {dst}",
      windows: "Move-Item '{src}' '{dst}'",
    },
  ],
  [
    "delete_file",
    {
      unix: "rm {path}",
      windows: "Remove-Item '{path}'",
    },
  ],
  [
    "get_processes",
    {
      unix: "ps aux",
      windows: "Get-Process | Format-Table",
    },
  ],
  [
    "check_disk",
    {
      unix: "df -h",
      windows: "Get-PSDrive | Format-Table",
    },
  ],
]);


export class ToolActionResolver {
  // -------------------------------------------------------------------------
  // resolve
  // -------------------------------------------------------------------------

  /**
   * Resolve a generic intent + params into a ToolAction.
   *
   * If the intent is in the translation table and a platform is provided,
   * injects `params.command` with the platform-specific command string and
   * sets the capability to `shell_exec`.
   * Otherwise, uses the intent name directly as the capability.
   */
  resolve(
    intent: string,
    params: Record<string, unknown>,
    toolId: string,
    platform: PlatformType | undefined,
    agentId: string,
  ): ToolAction {
    const resolvedParams: Record<string, unknown> = { ...params };

    const translation = TRANSLATION_TABLE.get(intent);
    let capability: string;

    if (translation !== undefined && platform !== undefined) {
      resolvedParams["command"] = this.translateCommand(intent, platform, params);
      capability = "shell_exec";
    } else {
      capability = intent;
    }

    return {
      tool_id: toolId,
      capability,
      params: resolvedParams,
      agent_id: agentId,
    };
  }

  // -------------------------------------------------------------------------
  // translateCommand
  // -------------------------------------------------------------------------

  /**
   * Get the platform-specific command string for an intent.
   * Substitutes {path}, {src}, {dst} from params.
   * Throws if the intent is not in the translation table.
   */
  translateCommand(
    intent: string,
    platform: PlatformType,
    params: Record<string, unknown>,
  ): string {
    const translation = TRANSLATION_TABLE.get(intent);
    if (translation === undefined) {
      throw new Error(`ToolActionResolver: no translation for intent "${intent}"`);
    }

    const family = this.platformFamily(platform);
    const template = family === "windows" ? translation.windows : translation.unix;

    return this.substituteTemplate(template, params);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private platformFamily(platform: PlatformType): PlatformFamily {
    if (WINDOWS_PLATFORMS.has(platform)) {
      return "windows";
    }
    return "unix";
  }

  /**
   * Replace {path}, {src}, {dst} in a template string with param values.
   * Unknown placeholders are left as-is.
   */
  private substituteTemplate(
    template: string,
    params: Record<string, unknown>,
  ): string {
    return template.replace(
      /\{(path|src|dst)\}/g,
      (_match, key: string) => {
        const val = params[key];
        return val !== undefined ? String(val) : `{${key}}`;
      },
    );
  }
}
