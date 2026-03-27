// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — useApi hook
 *
 * Generic data-fetching hook that wraps a SidjuaApiClient call.
 * Returns { data, loading, error, refetch }.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppConfig } from '../lib/config';
import type { SidjuaApiClient } from '../api/client';
import { ApiError } from '../api/client';

export interface UseApiResult<T> {
  data:    T | null;
  loading: boolean;
  error:   string | null;
  refetch: () => void;
}

/**
 * Fetches data using the authenticated SidjuaApiClient.
 *
 * @param fetcher  Function that receives the client and an AbortSignal, returns a Promise<T>.
 *                 Return `null` to skip the fetch (e.g. when filters are empty).
 *                 Pass the signal to client methods to cancel on unmount.
 * @param deps     Re-fetch when these values change (in addition to client changes).
 */
export function useApi<T>(
  fetcher: (client: SidjuaApiClient, signal: AbortSignal) => Promise<T> | null,
  deps: unknown[] = [],
): UseApiResult<T> {
  const { client } = useAppConfig();

  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // AbortController ref — aborted on component unmount to cancel in-flight requests
  // and prevent stale state updates on unmounted components.
  const controllerRef = useRef<AbortController | null>(null);

  const fetch = useCallback(() => {
    if (!client) {
      setError('Not connected — configure server URL and API key in Settings.');
      return;
    }

    // Abort any previously in-flight request before starting a new one
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const promise = fetcher(client, controller.signal);
    if (promise === null) return;

    setLoading(true);
    setError(null);

    promise
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          if (err instanceof ApiError) {
            setError(err.message);
          } else if (err instanceof Error) {
            setError(err.message);
          } else {
            setError('Unknown error');
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, ...deps]);

  useEffect(() => {
    fetch();
    return () => {
      // Abort the in-flight request when the component unmounts
      controllerRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
