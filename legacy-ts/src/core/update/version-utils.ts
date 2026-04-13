// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Shared semver utility.
 *
 * Single canonical implementation used by both the update-check and
 * npm-update-provider modules (previously duplicated in each).
 */

/**
 * Minimal semver greater-than comparison for X.Y.Z strings.
 * Returns true when a > b.
 */
export function semverGt(a: string, b: string): boolean {
  const parse = (s: string): number[] =>
    s.split(".").map((p) => parseInt(p.replace(/[^0-9]/g, ""), 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}
