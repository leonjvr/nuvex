// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import React from 'react';
import type { AgentLifecycleStatus, TaskStatus } from '../../api/types';

type Status = AgentLifecycleStatus | TaskStatus | string;

interface Props {
  status: Status;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'muted';

const STATUS_MAP: Record<string, Variant> = {
  // Agent statuses
  active:   'success',
  idle:     'info',
  starting: 'warning',
  stopping: 'warning',
  stopped:  'muted',
  error:    'danger',
  // Task statuses
  CREATED:   'neutral',
  PENDING:   'neutral',
  ASSIGNED:  'info',
  RUNNING:   'info',
  WAITING:   'warning',
  REVIEW:    'warning',
  DONE:      'success',
  FAILED:    'danger',
  ESCALATED: 'danger',
  CANCELLED: 'muted',
  // Extra
  busy:     'info',
  blocked:  'warning',
};

const DOT_COLORS: Record<Variant, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger:  'var(--color-danger)',
  info:    'var(--color-info)',
  neutral: 'var(--color-text-secondary)',
  muted:   'var(--color-text-muted)',
};

const LABEL_COLORS: Record<Variant, string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger:  'var(--color-danger)',
  info:    'var(--color-info)',
  neutral: 'var(--color-text-secondary)',
  muted:   'var(--color-text-muted)',
};

function resolveVariant(status: Status): Variant {
  return STATUS_MAP[status] ?? 'neutral';
}

export function StatusBadge({ status, size = 'md', showLabel = true }: Props) {
  const variant  = resolveVariant(status);
  const dotSize  = size === 'sm' ? 6 : 8;
  const fontSize = size === 'sm' ? '11px' : '12px';

  return (
    <span
      style={{
        display:    'inline-flex',
        alignItems: 'center',
        gap:        '5px',
        fontSize,
        color:      LABEL_COLORS[variant],
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width:        `${dotSize}px`,
          height:       `${dotSize}px`,
          borderRadius: '50%',
          background:   DOT_COLORS[variant],
          flexShrink:   0,
          ...(variant === 'success' ? {
            boxShadow: `0 0 0 2px color-mix(in srgb, var(--color-success) 25%, transparent)`,
          } : {}),
        }}
      />
      {showLabel && (
        <span style={{ textTransform: 'capitalize' }}>{status.toLowerCase()}</span>
      )}
    </span>
  );
}
