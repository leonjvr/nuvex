// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import { useApi } from './useApi';
import type { AgentResponse } from '../api/types';

export function useAgent(id: string | null) {
  return useApi<AgentResponse>(
    (client) => (id ? client.getAgent(id) : null),
    [id],
  );
}
