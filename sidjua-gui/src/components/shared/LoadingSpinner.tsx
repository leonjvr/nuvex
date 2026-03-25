// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import React from 'react';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const SIZES = { sm: 16, md: 24, lg: 40 };

export function LoadingSpinner({ size = 'md', label = 'Loading…' }: Props) {
  const px = SIZES[size];

  return (
    <span
      role="status"
      aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        style={{ animation: 'spin 0.8s linear infinite', color: 'var(--color-accent)' }}
        aria-hidden="true"
      >
        <circle
          cx="12" cy="12" r="10"
          stroke="currentColor"
          strokeWidth="3"
          strokeOpacity="0.2"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </span>
  );
}
