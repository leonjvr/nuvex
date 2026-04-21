// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Organisation } from '../api/types';
import { useAppConfig } from './config';

const STORAGE_KEY = 'sidjua.selectedOrg';

interface OrgContextValue {
  orgs:          Organisation[];
  selectedOrg:   string | null; // null = "All Organisations"
  setSelectedOrg: (id: string | null) => void;
  loading:       boolean;
  refresh:       () => void;
}

const OrgContext = createContext<OrgContextValue>({
  orgs:           [],
  selectedOrg:    null,
  setSelectedOrg: () => undefined,
  loading:        false,
  refresh:        () => undefined,
});

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAppConfig();
  const [orgs,    setOrgs]    = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrg, setSelectedOrgState] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? null; } catch { return null; }
  });

  const setSelectedOrg = useCallback((id: string | null) => {
    setSelectedOrgState(id);
    try {
      if (id === null) localStorage.removeItem(STORAGE_KEY);
      else             localStorage.setItem(STORAGE_KEY, id);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(() => {
    if (!client) return;
    setLoading(true);
    client.listOrgs()
      .then((data) => { setOrgs(data); })
      .catch(() => { setOrgs([]); })
      .finally(() => { setLoading(false); });
  }, [client]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <OrgContext.Provider value={{ orgs, selectedOrg, setSelectedOrg, loading, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg(): OrgContextValue {
  return useContext(OrgContext);
}
