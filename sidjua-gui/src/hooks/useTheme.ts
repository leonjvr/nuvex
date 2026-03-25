// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — useTheme hook
 * Re-exports the ThemeContext value. Import from here to avoid
 * coupling component files to the context implementation.
 */
export { useTheme } from '../lib/theme';
export type { Theme, ThemeContextValue } from '../lib/theme';
