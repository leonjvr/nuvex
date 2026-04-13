// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — YAML utilities
 *
 * Thin wrappers around the `yaml` package for safe file reading and hashing.
 * All YAML parsing goes through here so error handling is consistent.
 */

import { sha256hex } from "../core/crypto-utils.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

/**
 * Read a file at `filePath` and parse it as YAML.
 * Returns the raw parsed value (unknown — caller must validate the shape).
 *
 * @throws {Error} if the file cannot be read or is not valid YAML
 */
export function readYamlFile(filePath: string): unknown {
  const absolutePath = resolve(filePath);
  let content: string;
  try {
    content = readFileSync(absolutePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read YAML file at "${absolutePath}": ${msg}`);
  }
  try {
    return parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML at "${absolutePath}": ${msg}`);
  }
}

/**
 * Read a file and return both its raw parsed YAML and the SHA-256 hex hash
 * of its original content (for state tracking).
 *
 * @throws {Error} if the file cannot be read or is not valid YAML
 */
export function readYamlFileWithHash(filePath: string): {
  parsed: unknown;
  contentHash: string;
  absolutePath: string;
} {
  const absolutePath = resolve(filePath);
  let content: string;
  try {
    content = readFileSync(absolutePath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read YAML file at "${absolutePath}": ${msg}`);
  }
  const contentHash = sha256(content);
  try {
    const parsed = parse(content);
    return { parsed, contentHash, absolutePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML at "${absolutePath}": ${msg}`);
  }
}

/**
 * Compute the SHA-256 hex digest of a string.
 */
export function sha256(content: string): string {
  return sha256hex(content);
}
