// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import { useApi } from './useApi';
import type { DivisionsResponse } from '../api/types';

export function useDivisions() {
  return useApi<DivisionsResponse>((client) => client.listDivisions());
}
