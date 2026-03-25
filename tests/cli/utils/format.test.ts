// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect } from "vitest";
import { formatBytes, formatAge } from "../../../src/cli/utils/format.js";

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("returns bytes for values under 1 KB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("returns KB for values in [1 KB, 1 MB)", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1024 * 1023)).toBe("1023.0 KB");
  });

  it("returns MB for values in [1 MB, 1 GB)", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 512)).toBe("512.0 MB");
  });

  it("returns GB for values >= 1 GB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe("2.00 GB");
  });
});

describe("formatAge", () => {
  it("returns seconds for sub-minute age", () => {
    const now = Date.now();
    const ts = new Date(now - 30_000).toISOString();
    expect(formatAge(ts, now)).toBe("30s");
  });

  it("returns minutes for sub-hour age", () => {
    const now = Date.now();
    const ts = new Date(now - 5 * 60_000).toISOString();
    expect(formatAge(ts, now)).toBe("5m");
  });

  it("returns hours for sub-day age", () => {
    const now = Date.now();
    const ts = new Date(now - 3 * 3600_000).toISOString();
    expect(formatAge(ts, now)).toBe("3h");
  });

  it("returns days for multi-day age", () => {
    const now = Date.now();
    const ts = new Date(now - 2 * 86400_000).toISOString();
    expect(formatAge(ts, now)).toBe("2d");
  });
});
