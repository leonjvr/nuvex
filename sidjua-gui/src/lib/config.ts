// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — App Configuration Context
 *
 * Stores server URL, API key, and connection state.
 * Persists to localStorage (falls back gracefully when unavailable).
 */

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode, createElement } from 'react';
import { SidjuaApiClient } from '../api/client';


export interface AppConfig {
  serverUrl: string;
  apiKey: string;
}

export type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'error';

export interface BuildInfo {
  version:     string;
  buildDate:   string | null;
  buildRef:    string | null;
  buildNumber: number | null;
}

export interface AppConfigContextValue {
  config: AppConfig;
  status: ConnectionStatus;
  /** True while the GUI is fetching the API key from /api/v1/gui-bootstrap. */
  bootstrapping: boolean;
  /** Build metadata from /api/v1/health — null until fetched. */
  buildInfo: BuildInfo | null;
  setConfig: (config: AppConfig) => void;
  testConnection: () => Promise<boolean>;
  client: SidjuaApiClient | null;
}


// P281: Type declaration for the server-injected bootstrap object.
interface SidjuaBootstrap {
  api_key:     string;
  server_url?: string;
}
interface WindowWithBootstrap extends Window {
  __SIDJUA_BOOTSTRAP__?: SidjuaBootstrap;
}

const STORAGE_KEY = 'sidjua-config';

const DEFAULT_CONFIG: AppConfig = {
  serverUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4200',
  apiKey:    '',
};

// ---------------------------------------------------------------------------
// Key obfuscation helpers
//
// NOTE: This is NOT cryptographic security — it prevents casual plaintext
// extraction from localStorage by XSS or nosy browser extensions.
// V2 will use the Tauri Secure Store plugin for proper OS keychain storage.
// TODO(v2): Replace with @tauri-apps/plugin-secure-storage
// ---------------------------------------------------------------------------

function obfuscateKey(key: string): string {
  // Base64 + reverse: not crypto-secure, but prevents trivial plaintext read
  return btoa(key.split('').reverse().join(''));
}

function deobfuscateKey(encoded: string): string {
  try {
    return atob(encoded).split('').reverse().join('');
  } catch {
    // If decoding fails, return as-is (migration from old plaintext storage)
    return encoded;
  }
}

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      const apiKey = parsed.apiKey ? deobfuscateKey(parsed.apiKey) : DEFAULT_CONFIG.apiKey;
      return {
        serverUrl: parsed.serverUrl ?? DEFAULT_CONFIG.serverUrl,
        apiKey,
      };
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_CONFIG;
}

function saveConfig(cfg: AppConfig): void {
  try {
    const toStore: AppConfig = { ...cfg };
    if (toStore.apiKey) {
      toStore.apiKey = obfuscateKey(toStore.apiKey);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // ignore storage errors
  }
}

/**
 * Read the stored API key directly from localStorage (no React state required).
 * Used by useTranslation to attach an Authorization header to locale-persistence
 * requests without creating a dependency on the config context.
 */
export function getStoredApiKey(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return parsed.apiKey ? deobfuscateKey(parsed.apiKey) : '';
  } catch {
    return '';
  }
}


export const AppConfigContext = createContext<AppConfigContextValue>({
  config:          DEFAULT_CONFIG,
  status:          'unknown',
  bootstrapping:   false,
  buildInfo:       null,
  setConfig:       () => undefined,
  testConnection:  async () => false,
  client:          null,
});

export function useAppConfig(): AppConfigContextValue {
  return useContext(AppConfigContext);
}


export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<AppConfig>(loadConfig);
  const [status, setStatus]      = useState<ConnectionStatus>('unknown');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [buildInfo, setBuildInfo]         = useState<BuildInfo | null>(null);

  // Guard: only attempt bootstrap once per mount
  const bootstrapAttempted = useRef(false);
  // Guard: max 1 auth-failure recovery cycle to prevent infinite loops
  const rebootstrapCount   = useRef(0);

  // Stable ref so the useMemo dependency array stays clean
  const handleAuthFailureRef = useRef<() => void>(() => undefined);
  handleAuthFailureRef.current = () => {
    if (rebootstrapCount.current >= 1) return;
    rebootstrapCount.current += 1;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    bootstrapAttempted.current = false;
    setConfigState((prev) => ({ ...prev, apiKey: '' }));
  };

  const client = useMemo(
    () => config.apiKey
      ? new SidjuaApiClient(config.serverUrl, config.apiKey, () => handleAuthFailureRef.current())
      : null,
    [config.serverUrl, config.apiKey],
  );

  const setConfig = useCallback((next: AppConfig) => {
    setConfigState(next);
    saveConfig(next);
    setStatus('unknown');
  }, []);

  const testConnection = useCallback(async (): Promise<boolean> => {
    if (!client) {
      setStatus('error');
      return false;
    }
    setStatus('checking');
    try {
      await client.health();
      setStatus('connected');
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, [client]);

  // Auto-check whenever we have credentials (runs on mount AND after bootstrap sets the key)
  useEffect(() => {
    if (config.apiKey) {
      void testConnection();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiKey]);

  // Fetch build info from public /health endpoint (no auth required)
  useEffect(() => {
    const serverUrl = config.serverUrl || window.location.origin;
    fetch(`${serverUrl}/api/v1/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          const h = data as Record<string, unknown>;
          const version     = typeof h['version']      === 'string' ? h['version']      : 'dev';
          const buildDate   = typeof h['build_date']   === 'string' ? h['build_date']   : null;
          const buildRef    = typeof h['build_ref']    === 'string' ? h['build_ref']    : null;
          const buildNumber = typeof h['build_number'] === 'number' ? h['build_number'] : null;
          setBuildInfo({ version, buildDate, buildRef, buildNumber });
        }
      })
      .catch(() => { /* server not reachable yet — buildInfo stays null */ });
  }, [config.serverUrl]);

  // GUI bootstrap: if apiKey is absent, obtain it without manual config.
  // P281: Check window.__SIDJUA_BOOTSTRAP__ (injected server-side) first —
  // no extra HTTP round-trip required. Falls back to fetching /api/v1/gui-bootstrap
  // for environments where server-side injection is unavailable.
  useEffect(() => {
    if (config.apiKey || bootstrapAttempted.current) return;
    bootstrapAttempted.current = true;

    // P281: Use server-injected bootstrap if available
    const injected = (window as WindowWithBootstrap).__SIDJUA_BOOTSTRAP__;
    if (typeof injected?.api_key === 'string' && injected.api_key) {
      const serverUrl = injected.server_url || config.serverUrl || window.location.origin;
      setConfig({ serverUrl, apiKey: injected.api_key });
      return;
    }

    // Fallback: fetch from /api/v1/gui-bootstrap (DEPRECATED: P281 — use server-side injection)
    const serverUrl = config.serverUrl || window.location.origin;
    setBootstrapping(true);

    fetch(`${serverUrl}/api/v1/gui-bootstrap`, { method: 'GET' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: unknown) => {
        const apiKey = (data as Record<string, unknown>)['api_key'];
        if (typeof apiKey === 'string' && apiKey) {
          const next: AppConfig = { serverUrl, apiKey };
          setConfig(next);
        }
      })
      .catch(() => { /* bootstrap unavailable — user must configure manually */ })
      .finally(() => { setBootstrapping(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AppConfigContextValue = {
    config,
    status,
    bootstrapping,
    buildInfo,
    setConfig,
    testConnection,
    client,
  };

  return createElement(AppConfigContext.Provider, { value }, children);
}
