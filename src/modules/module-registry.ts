// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Module Registry
 *
 * Persists installed-module records to `workDir/.system/modules/.registry.json`.
 * Pure JSON — no SQLite, no heavy deps.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync }                 from "node:fs";
import { join }                       from "node:path";
import type { ModuleRegistryEntry }   from "./module-types.js";


function registryPath(workDir: string): string {
  return join(workDir, ".system", "modules", ".registry.json");
}

function modulesDir(workDir: string): string {
  return join(workDir, ".system", "modules");
}


async function readRegistry(workDir: string): Promise<ModuleRegistryEntry[]> {
  const path = registryPath(workDir);
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as ModuleRegistryEntry[];
}

async function writeRegistry(workDir: string, entries: ModuleRegistryEntry[]): Promise<void> {
  await mkdir(modulesDir(workDir), { recursive: true });
  await writeFile(registryPath(workDir), JSON.stringify(entries, null, 2), "utf-8");
}


/**
 * Register a module as installed.
 */
export async function register(workDir: string, entry: ModuleRegistryEntry): Promise<void> {
  const entries = await readRegistry(workDir);
  const filtered = entries.filter((e) => e.id !== entry.id);
  filtered.push(entry);
  await writeRegistry(workDir, filtered);
}

/**
 * Unregister a module.  No-op if not installed.
 */
export async function unregister(workDir: string, id: string): Promise<void> {
  const entries = await readRegistry(workDir);
  const filtered = entries.filter((e) => e.id !== id);
  await writeRegistry(workDir, filtered);
}

/**
 * Check if a module is registered.
 */
export async function isInstalled(workDir: string, id: string): Promise<boolean> {
  const entries = await readRegistry(workDir);
  return entries.some((e) => e.id === id);
}

/**
 * Get all installed module entries.
 */
export async function getInstalled(workDir: string): Promise<ModuleRegistryEntry[]> {
  return readRegistry(workDir);
}

/**
 * Get the install path for a module, or undefined if not installed.
 */
export async function getInstallPath(workDir: string, id: string): Promise<string | undefined> {
  const entries = await readRegistry(workDir);
  return entries.find((e) => e.id === id)?.installPath;
}
