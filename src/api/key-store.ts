// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — SQLite-backed API key state store
 *
 * Persists current key, pending (grace-period) key, and expiry timestamp to
 * the .system/sidjua.db database so they survive server restarts.
 *
 * Schema (single-row table enforced by CHECK(id = 1)):
 *   CREATE TABLE api_key_state (
 *     id               INTEGER PRIMARY KEY CHECK (id = 1),
 *     current_key      TEXT    NOT NULL,
 *     pending_key      TEXT,
 *     pending_expires_at TEXT   -- ISO-8601 UTC, null when no grace period
 *   )
 *
 * Encryption: AES-256-GCM using a per-installation random master key stored
 * in {systemDir}/master.key (mode 0o600). On first run the key is generated
 * automatically. Existing installations using the legacy hostname-derived key
 * are migrated transparently on next read/write.
 *
 * NOTE: Multi-worker/cluster support requires shared DB or Redis.
 *       This implementation targets single-process V1 deployments.
 */

import Database                                          from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes,
         createHash }                                    from "node:crypto";
import { hostname }                                      from "node:os";
import { readFileSync, writeFileSync, mkdirSync }         from "node:fs";
import { join, dirname }                                 from "node:path";
import { createLogger }                                  from "../core/logger.js";
import { openDatabase }                                  from "../utils/db.js";

const logger = createLogger("api-key-store");


const CIPHER_ALGO    = "aes-256-gcm";
const MASTER_KEY_LEN = 32;
const MASTER_KEY_FILE = "master.key";
/** Salt kept only for migration from the legacy hostname-derived scheme. */
const LEGACY_SALT    = "sidjua-key-store-v1";


// ---------------------------------------------------------------------------
// Master key management (enterprise seam for V1.1 OS keystore)
// ---------------------------------------------------------------------------

/**
 * Abstraction over master key storage.
 * V1.0: file-based (FileMasterKeySource).
 * V1.1: OS keystore (Keychain / libsecret / DPAPI) without touching encryption logic.
 */
interface MasterKeySource {
  loadKey(): Buffer | null;
  storeKey(key: Buffer): void;
}

class FileMasterKeySource implements MasterKeySource {
  constructor(private readonly keyPath: string) {}

  loadKey(): Buffer | null {
    try {
      return readFileSync(this.keyPath);
    } catch (_e) {
      return null;
    }
  }

  storeKey(key: Buffer): void {
    mkdirSync(dirname(this.keyPath), { recursive: true });
    writeFileSync(this.keyPath, key, { mode: 0o600 });
  }
}

/**
 * Load the master key from `{systemDir}/master.key`.
 * If the file does not exist, generate a cryptographically random 32-byte key
 * and persist it (mode 0o600) before returning.
 */
function getOrCreateMasterKey(systemDir: string): Buffer {
  const keyPath = join(systemDir, MASTER_KEY_FILE);
  const source  = new FileMasterKeySource(keyPath);

  const existing = source.loadKey();
  if (existing !== null && existing.length === MASTER_KEY_LEN) {
    return existing;
  }

  const key = randomBytes(MASTER_KEY_LEN);
  source.storeKey(key);
  logger.info("master_key_created", "Generated new master key for API key encryption", {
    metadata: { path: keyPath },
  });
  return key;
}

/**
 * Derive the legacy hostname-based key (used only for migration).
 * Never used for new encryptions.
 */
function deriveLegacyKey(): Buffer {
  return createHash("sha256").update(`${LEGACY_SALT}:${hostname()}`).digest();
}


// Module-level master key state.
// - Set from the filesystem by loadKeyState / persistKeyState (production path).
// - Falls back to a process-lifetime ephemeral key when called directly (tests).
const _ephemeralKey: Buffer = randomBytes(MASTER_KEY_LEN);
let   _masterKey:    Buffer | null = null;

function getEncryptionKey(): Buffer {
  return _masterKey ?? _ephemeralKey;
}

/** Exposed for tests that need to reset per-module key state. */
export function _resetMasterKey(): void {
  _masterKey = null;
}


// ---------------------------------------------------------------------------
// Low-level encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext with AES-256-GCM.
 * Wire format: base64(iv[16] | authTag[16] | ciphertext)
 */
function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv     = randomBytes(16);
  const cipher = createCipheriv(CIPHER_ALGO, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypt AES-256-GCM ciphertext. Returns null on authentication failure.
 */
function decryptWithKey(encoded: string, key: Buffer): string | null {
  const data = Buffer.from(encoded, "base64");
  if (data.length < 33) return null;   // too short — fail closed
  const iv      = data.subarray(0, 16);
  const tag     = data.subarray(16, 32);
  const enc     = data.subarray(32);
  const decipher = createDecipheriv(CIPHER_ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return decipher.update(enc).toString("utf8") + decipher.final("utf8");
  } catch (_e) {
    return null;
  }
}

/**
 * Heuristic: value is likely encrypted if it is valid base64 with length ≥ 44
 * (minimum: 16 IV + 16 tag + 1 byte payload = 33 bytes → 44 base64 chars).
 */
function isBase64Encrypted(value: string): boolean {
  if (value.length < 44) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}


// ---------------------------------------------------------------------------
// Public encrypt / decrypt API (stable, backward-compatible signatures)
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext API key using the current master key.
 * Wire format: base64(iv[16] | authTag[16] | ciphertext)
 */
export function encryptApiKey(plaintext: string): string {
  return encryptWithKey(plaintext, getEncryptionKey());
}

/**
 * Decrypt an encrypted API key.
 *
 * - Detects plaintext (not base64) and returns it as-is (legacy migration).
 * - Tries the current master key first.
 * - Falls back to the legacy hostname-derived key for installations migrating
 *   from the old scheme; logs an info message to prompt the next write to
 *   re-encrypt with the master key.
 * - Returns null if all decryption attempts fail (fail-closed).
 */
export function decryptApiKey(encoded: string): string | null {
  // Migration guard: plaintext values were stored before encryption was added.
  if (!isBase64Encrypted(encoded)) return encoded;

  const masterKey = getEncryptionKey();

  // Primary: current master key
  const result = decryptWithKey(encoded, masterKey);
  if (result !== null) return result;

  // Migration fallback: legacy hostname-derived key
  const legacyKey = deriveLegacyKey();
  const migrated  = decryptWithKey(encoded, legacyKey);
  if (migrated !== null) {
    logger.info("api_key_legacy_decrypted",
      "API key decrypted with legacy hostname-derived key. Re-encrypt by running: sidjua api-key rotate", {});
    return migrated;
  }

  // Both failed — fail closed
  logger.error("api_key_decrypt_failed",
    "Could not decrypt stored key — stored key state is invalid. Regenerate the API key.", {});
  return null;
}


// ---------------------------------------------------------------------------
// Database schema
// ---------------------------------------------------------------------------

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_key_state (
      id                 INTEGER PRIMARY KEY CHECK (id = 1),
      current_key        TEXT    NOT NULL,
      pending_key        TEXT,
      pending_expires_at TEXT
    )
  `);
}


// ---------------------------------------------------------------------------
// Public API: KeyState, loadKeyState, persistKeyState, KeyStore
// ---------------------------------------------------------------------------

export interface KeyState {
  currentKey:       string;
  pendingKey:       string | null;
  /** ISO-8601 UTC expiry for pendingKey. null = no grace period active. */
  pendingExpiresAt: string | null;
}


function openDb(dbPath: string): Database.Database | null {
  try {
    const db = openDatabase(dbPath);
    ensureTable(db);
    return db;
  } catch (err) {
    logger.warn("api_key_store_open_failed", "Could not open key-state DB — using in-memory only", {
      metadata: { path: dbPath, error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}


/**
 * Load API key state from the SQLite database at dbPath.
 *
 * Initialises the master key from `{systemDir}/master.key` before decrypting,
 * migrating transparently from any legacy hostname-derived ciphertext.
 *
 * @returns The loaded KeyState, or null if the DB has no state yet.
 */
export function loadKeyState(dbPath: string): KeyState | null {
  // Initialise / load the master key from the filesystem.
  const systemDir = dirname(dbPath);
  _masterKey = getOrCreateMasterKey(systemDir);

  const db = openDb(dbPath);
  if (db === null) return null;
  try {
    type Row = { current_key: string; pending_key: string | null; pending_expires_at: string | null };
    const row = db.prepare<[], Row>(
      "SELECT current_key, pending_key, pending_expires_at FROM api_key_state WHERE id = 1",
    ).get();
    if (row === undefined) return null;

    // Decrypt current key — migrates legacy ciphertext transparently.
    const currentKey = decryptApiKey(row.current_key);
    if (currentKey === null) {
      logger.error("api_key_store_corrupt", "Current key decryption failed — discarding stored state", {});
      return null;
    }

    // Honor pending key only if it has not yet expired.
    let pendingKey: string | null       = null;
    if (row.pending_key !== null) {
      const dec  = decryptApiKey(row.pending_key);
      pendingKey = dec; // null on failure → treat as no pending key (safe default)
    }
    let pendingExpiresAt: string | null = row.pending_expires_at;
    if (pendingExpiresAt !== null && Date.now() >= new Date(pendingExpiresAt).getTime()) {
      pendingKey       = null;
      pendingExpiresAt = null;
    }

    return { currentKey, pendingKey, pendingExpiresAt };
  } catch (err) {
    logger.warn("api_key_store_load_failed", "Could not load key state from DB", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  } finally {
    db.close();
  }
}


/**
 * Persist API key state to the SQLite database at dbPath.
 *
 * Always encrypts with the current master key, completing migration from any
 * legacy scheme on the next write.
 */
export function persistKeyState(dbPath: string, state: KeyState): void {
  // Always load/create master key from the correct systemDir — ensures the key used
  // for encryption always matches the key that loadKeyState will read on decryption.
  _masterKey = getOrCreateMasterKey(dirname(dbPath));

  const db = openDb(dbPath);
  if (db === null) return;
  try {
    const encCurrent = state.currentKey ? encryptApiKey(state.currentKey) : state.currentKey;
    const encPending = state.pendingKey ? encryptApiKey(state.pendingKey) : state.pendingKey;
    db.prepare(
      `INSERT OR REPLACE INTO api_key_state
         (id, current_key, pending_key, pending_expires_at)
       VALUES (1, ?, ?, ?)`,
    ).run(encCurrent, encPending ?? null, state.pendingExpiresAt ?? null);
    logger.info("api_key_state_persisted", "API key state persisted to DB", {});
  } catch (err) {
    logger.warn("api_key_store_persist_failed", "Could not persist key state to DB", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    db.close();
  }
}


/**
 * Manages the current and pending (grace-period) API keys.
 * Wraps module-level state to avoid raw property access scattered across callers.
 * DB persistence is best-effort — failures are logged but do not crash the process.
 */
export class KeyStore {
  private currentKey = "";
  private pendingKey: string | null = null;

  /** Return the currently-active key. */
  getCurrent(): string { return this.currentKey; }

  /** Return the pending (grace-period) key, or null if none is active. */
  getPending(): string | null { return this.pendingKey; }

  /** Set a new current key. */
  setCurrent(key: string): void { this.currentKey = key; }

  /** Set the pending (grace-period) key. Null clears it. */
  setPending(key: string | null): void { this.pendingKey = key; }

  /** Load state from a persisted DB path on startup. */
  loadFrom(dbPath: string): void {
    const state = loadKeyState(dbPath);
    if (state !== null) {
      this.currentKey = state.currentKey;
      this.pendingKey = state.pendingKey;
    }
  }

  /** Persist current state to a DB path. */
  persistTo(dbPath: string, pendingExpiresAt: string | null = null): void {
    persistKeyState(dbPath, {
      currentKey:       this.currentKey,
      pendingKey:       this.pendingKey,
      pendingExpiresAt,
    });
  }

  /** Reset to empty (for tests). */
  reset(): void {
    this.currentKey = "";
    this.pendingKey = null;
  }
}
