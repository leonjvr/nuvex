// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import { useApi } from './useApi';
import type { AgentsResponse, AgentLifecycleStatus } from '../api/types';

export interface AgentFilters {
  division?: string;
  status?: AgentLifecycleStatus;
  tier?: 1 | 2 | 3;
}

export function useAgents(filters: AgentFilters = {}) {
  return useApi<AgentsResponse>(
    (client) => client.listAgents(filters),
    [filters.division, filters.status, filters.tier],
  );
}
