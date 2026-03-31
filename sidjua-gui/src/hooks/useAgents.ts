// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import { useState, useEffect } from 'react';
import { useApi } from './useApi';
import type { AgentsResponse, AgentLifecycleStatus } from '../api/types';

export interface AgentFilters {
  division?: string;
  status?: AgentLifecycleStatus;
  tier?: 1 | 2 | 3;
}

export function useAgents(filters: AgentFilters = {}, refreshKey?: number) {
  const [autoKey, setAutoKey] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setAutoKey((k) => k + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return useApi<AgentsResponse>(
    (client) => client.listAgents(filters),
    [filters.division, filters.status, filters.tier, refreshKey, autoKey],
  );
}
