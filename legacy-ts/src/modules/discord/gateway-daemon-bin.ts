// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Discord Gateway — standalone entry point.
 *
 * This file is compiled as a separate tsup entry so that it gets its own
 * output file (dist/modules/discord/gateway-daemon-bin.js).  Running it
 * directly starts the daemon; importing gateway-daemon.ts in the main
 * bundle remains side-effect-free.
 *
 * Usage:
 *   node dist/modules/discord/gateway-daemon-bin.js
 */

import { main } from "./gateway-daemon.js";

void main();
