// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — App Configuration Context
 *
 * Stores server URL and connection state.
 * The API key is held in React state ONLY — never persisted to localStorage.
 * Server URL (non-secret) is persisted to localStorage for convenience.
 *
 * The API key is obtained via the server-injected window.__SIDJUA_BOOTSTRAP__
 * object; the user must re-enter it after a hard page reload if bootstrap is
 * unavailable (e.g. direct browser navigation to the UI URL).
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
  /** @deprecated Always false — bootstrap fetch removed in favour of server-side injection. */
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
// Runtime-only API key store
//
// The API key is kept in memory only — never written to localStorage.
// getRuntimeApiKey() is used by non-React code (e.g. useTranslation) that
// needs the key for authenticated requests but cannot access React context.
// ---------------------------------------------------------------------------

let _runtimeApiKey = '';

/** Update the in-memory API key. Called by AppConfigProvider on key change. */
export function setRuntimeApiKey(key: string): void {
  _runtimeApiKey = key;
}

/**
 * Read the in-memory API key without React context.
 * Used by useTranslation to attach an Authorization header to locale-persistence
 * requests. Returns '' when no key has been set yet.
 */
export function getRuntimeApiKey(): string {
  return _runtimeApiKey;
}

/** Load server URL from localStorage. API key is intentionally excluded. */
function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        serverUrl: parsed.serverUrl ?? DEFAULT_CONFIG.serverUrl,
        apiKey:    '',  // never loaded from storage
      };
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_CONFIG;
}

/** Save server URL to localStorage. API key is intentionally excluded. */
function saveConfig(cfg: AppConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverUrl: cfg.serverUrl }));
  } catch {
    // ignore storage errors
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
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  // Guard: max 1 auth-failure recovery cycle to prevent infinite loops
  const rebootstrapCount = useRef(0);

  // Stable ref so the useMemo dependency array stays clean
  const handleAuthFailureRef = useRef<() => void>(() => undefined);
  handleAuthFailureRef.current = () => {
    if (rebootstrapCount.current >= 1) return;
    rebootstrapCount.current += 1;
    setRuntimeApiKey('');
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

  // Keep runtime key in sync with React state
  useEffect(() => {
    setRuntimeApiKey(config.apiKey);
  }, [config.apiKey]);

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

  // GUI bootstrap: read the API key from the server-injected window object.
  // The key is injected into window.__SIDJUA_BOOTSTRAP__ by serveIndexHtmlWithBootstrap()
  // on the server side before </head>.  No HTTP round-trip is required.
  useEffect(() => {
    if (config.apiKey) return;  // already have a key

    const injected = (window as WindowWithBootstrap).__SIDJUA_BOOTSTRAP__;
    if (typeof injected?.api_key === 'string' && injected.api_key) {
      const serverUrl = injected.server_url || config.serverUrl || window.location.origin;
      setConfig({ serverUrl, apiKey: injected.api_key });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: AppConfigContextValue = {
    config,
    status,
    bootstrapping:  false,  // no longer used — kept for interface stability
    buildInfo,
    setConfig,
    testConnection,
    client,
  };

  return createElement(AppConfigContext.Provider, { value }, children);
}
