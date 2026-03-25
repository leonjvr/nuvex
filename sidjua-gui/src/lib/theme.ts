// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — Theme Context
 *
 * Manages light / dark theme via `data-theme` attribute on <html>.
 * Persists preference to localStorage.
 * Respects system prefers-color-scheme on first visit.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode, createElement } from 'react';


export type Theme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}


const STORAGE_KEY = 'sidjua-theme';

function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return prefersDark() ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}


export const ThemeContext = createContext<ThemeContextValue>({
  theme:    'light',
  toggle:   () => undefined,
  setTheme: () => undefined,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}


export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = loadTheme();
    // Apply immediately to avoid flash of wrong theme
    applyTheme(t);
    return t;
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  // Keep DOM in sync if theme changes via other means
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value: ThemeContextValue = { theme, toggle, setTheme };

  return createElement(ThemeContext.Provider, { value }, children);
}
