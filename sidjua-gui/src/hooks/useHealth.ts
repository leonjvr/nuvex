// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import { useState, useEffect, useRef } from 'react';
import { useAppConfig } from '../lib/config';
import type { HealthStatus } from '../api/types';

const POLL_INTERVAL_MS = 30_000;

export function useHealth() {
  const { client } = useAppConfig();
  const [health,  setHealth]  = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    if (!client) {
      setError('Not connected');
      return;
    }

    let cancelled = false;

    async function poll() {
      if (!client) return;
      setLoading(true);
      try {
        const result = await client.health();
        if (!cancelled) {
          setHealth(result);
          setError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Health check failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void poll();
    timerRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [client]);

  return { health, loading, error };
}
