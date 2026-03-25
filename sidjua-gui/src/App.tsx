// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';

import { ThemeProvider }    from './lib/theme';
import { AppConfigProvider, useAppConfig } from './lib/config';
import { ToastProvider }    from './components/shared/Toast';
import { ErrorBoundary }    from './components/shared/ErrorBoundary';
import { Shell }            from './components/layout/Shell';
import { FirstRunOverlay }  from './components/overlay/FirstRunOverlay';
import { SidjuaApiClient }  from './api/client';

import { Dashboard }    from './pages/Dashboard';
import { Agents }       from './pages/Agents';
import { Chat }         from './pages/Chat';
import { Divisions }    from './pages/Divisions';
import { Governance }   from './pages/Governance';
import { AuditLog }     from './pages/AuditLog';
import { CostTracking } from './pages/CostTracking';
import { Configuration } from './pages/Configuration';
import { Settings }     from './pages/Settings';


function AppWithFirstRunGate() {
  const { config } = useAppConfig();

  // null = loading, true = completed, false = not yet completed
  const [firstRunCompleted, setFirstRunCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkFirstRun() {
      // If no server URL is configured yet, skip overlay (user must set up first)
      if (!config.serverUrl || !config.apiKey) {
        setFirstRunCompleted(true);
        return;
      }

      try {
        const client = new SidjuaApiClient(config.serverUrl, config.apiKey);
        const res    = await client.getWorkspaceConfig();
        if (!cancelled) {
          setFirstRunCompleted(res.firstRunCompleted);
        }
      } catch {
        // Network error or server not ready — skip overlay, don't block user
        if (!cancelled) setFirstRunCompleted(true);
      }
    }

    void checkFirstRun();
    return () => { cancelled = true; };
  }, [config.serverUrl, config.apiKey]);

  const handleDismiss = useCallback(async () => {
    setFirstRunCompleted(true);  // optimistic update — hide overlay immediately

    if (!config.serverUrl || !config.apiKey) return;
    try {
      const client = new SidjuaApiClient(config.serverUrl, config.apiKey);
      await client.completeFirstRun();
    } catch {
      // Non-fatal — overlay is already hidden; next load may show it again
    }
  }, [config.serverUrl, config.apiKey]);

  return (
    <BrowserRouter>
      <AppRoutes firstRunCompleted={firstRunCompleted} onDismiss={handleDismiss} />
    </BrowserRouter>
  );
}


interface AppRoutesProps {
  firstRunCompleted: boolean | null;
  onDismiss: () => void;
}

function AppRoutes({ firstRunCompleted, onDismiss }: AppRoutesProps) {
  const navigate = useNavigate();

  const handleGoToSettings = useCallback(() => {
    void onDismiss();
    navigate('/settings');
  }, [onDismiss, navigate]);

  return (
    <>
      {/* Show overlay when first run is not yet completed */}
      {firstRunCompleted === false && (
        <FirstRunOverlay onDismiss={onDismiss} onGoToSettings={handleGoToSettings} />
      )}

      {/* Main app — always rendered but visually covered by overlay when shown */}
      <Routes>
        <Route element={<Shell />}>
          <Route index              element={<Dashboard />}    />
          <Route path="chat"        element={<Navigate to="/chat/guide" replace />} />
          <Route path="chat/:agentId" element={<Chat />}       />
          <Route path="agents"      element={<Agents />}       />
          <Route path="divisions"   element={<Divisions />}    />
          <Route path="governance"  element={<Governance />}   />
          <Route path="audit"       element={<AuditLog />}     />
          <Route path="costs"       element={<CostTracking />} />
          <Route path="config"      element={<Configuration />}/>
          <Route path="settings"    element={<Settings />}     />
          {/* Catch-all → dashboard */}
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}


export default function App() {
  return (
    <ThemeProvider>
      <AppConfigProvider>
        <ToastProvider>
        <ErrorBoundary>
          <AppWithFirstRunGate />
        </ErrorBoundary>
        </ToastProvider>
      </AppConfigProvider>
    </ThemeProvider>
  );
}
