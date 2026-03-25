// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import React from 'react';

/**
 * Inline SVG icons for starter agent types.
 * No external icon library — air-gap safe.
 */

interface IconProps {
  size?: number;
  color?: string;
}

function icon(size: number, color: string, path: React.ReactNode) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export function CompassIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return icon(size, color, <>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </>);
}

export function UsersIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return icon(size, color, <>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>);
}

export function ServerIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return icon(size, color, <>
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </>);
}

export function ShieldCheckIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return icon(size, color, <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <polyline points="9 12 11 14 15 10" />
  </>);
}

export function BarChartIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return icon(size, color, <>
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6"  y1="20" x2="6"  y2="16" />
  </>);
}

export function BookOpenIcon({ size = 20, color = 'currentColor' }: IconProps) {
  return icon(size, color, <>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </>);
}

/**
 * Maps an icon name from YAML to a rendered icon component.
 * Falls back to a generic dot if the name is unrecognised.
 */
export function AgentIcon({
  name,
  size = 20,
  color = 'currentColor',
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  switch (name) {
    case 'compass':      return <CompassIcon    size={size} color={color} />;
    case 'users':        return <UsersIcon      size={size} color={color} />;
    case 'server':       return <ServerIcon     size={size} color={color} />;
    case 'shield-check': return <ShieldCheckIcon size={size} color={color} />;
    case 'bar-chart':    return <BarChartIcon   size={size} color={color} />;
    case 'book-open':    return <BookOpenIcon   size={size} color={color} />;
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="5" fill={color} />
        </svg>
      );
  }
}
