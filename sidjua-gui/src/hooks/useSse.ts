// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — useSse hook
 *
 * Manages an SSE connection to the SIDJUA server.
 * Returns the connection status and last received event.
 * Automatically starts/stops when the component mounts/unmounts.
 */

import { useState, useEffect, useRef } from 'react';
import { useAppConfig } from '../lib/config';
import { SidjuaSSEClient } from '../api/sse';
import type { SseEvent, SseFilters } from '../api/sse';

export type SseStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface UseSseResult {
  status:    SseStatus;
  lastEvent: SseEvent | null;
}

export function useSse(filters?: SseFilters): UseSseResult {
  const { config } = useAppConfig();

  const [status,    setStatus]    = useState<SseStatus>('disconnected');
  const [lastEvent, setLastEvent] = useState<SseEvent | null>(null);

  const clientRef = useRef<SidjuaSSEClient | null>(null);

  useEffect(() => {
    if (!config.apiKey) {
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');

    const client = new SidjuaSSEClient({
      baseUrl: config.serverUrl,
      apiKey:  config.apiKey,
      filters,
      onConnect:    () => setStatus('connected'),
      onDisconnect: () => setStatus('connecting'),  // reconnecting
      onError:      () => setStatus('error'),
      onEvent:      (ev) => setLastEvent(ev),
    });

    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      clientRef.current = null;
      setStatus('disconnected');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.serverUrl, config.apiKey]);

  return { status, lastEvent };
}
