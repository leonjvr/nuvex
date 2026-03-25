// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * `sidjua tls` CLI commands.
 *
 *   sidjua tls generate  [--cert <path>] [--key <path>] [--hostname <host>] [--days <n>]
 */

import type { Command } from "commander";
import {
  generateSelfSignedCert,
  DEFAULT_TLS_CONFIG,
} from "../../api/tls.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("tls-cli");

export function registerTlsCommands(program: Command): void {
  const tlsCmd = program.command("tls").description("TLS certificate management");

  tlsCmd
    .command("generate")
    .description("Generate a self-signed TLS certificate for the SIDJUA server")
    .option("--cert <path>",     "Output path for the certificate PEM",  DEFAULT_TLS_CONFIG.cert)
    .option("--key <path>",      "Output path for the private key PEM",  DEFAULT_TLS_CONFIG.key)
    .option("--hostname <host>", "Additional SAN hostname (added alongside localhost)", "localhost")
    .option("--days <n>",        "Certificate validity in days", "365")
    .action((opts: { cert: string; key: string; hostname: string; days: string }) => {
      const validDays = parseInt(opts.days, 10);
      if (isNaN(validDays) || validDays < 1) {
        process.stderr.write("Error: --days must be a positive integer\n");
        process.exit(1);
      }

      try {
        generateSelfSignedCert({
          certPath:  opts.cert,
          keyPath:   opts.key,
          hostname:  opts.hostname,
          validDays,
        });

        logger.info("tls_generated", `TLS certificate generated`, {
          metadata: { cert: opts.cert, key: opts.key, hostname: opts.hostname, days: validDays },
        });

        process.stdout.write(`TLS certificate generated at ${opts.cert}\n`);
        process.stdout.write(`Private key written to       ${opts.key}\n`);
        process.stdout.write(`\nTo enable TLS, set in your environment:\n`);
        process.stdout.write(`  SIDJUA_TLS_ENABLED=true\n`);
        process.stdout.write(`  SIDJUA_TLS_CERT=${opts.cert}\n`);
        process.stdout.write(`  SIDJUA_TLS_KEY=${opts.key}\n`);
      } catch (err: unknown) {
        process.stderr.write(
          `Error generating certificate: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.stderr.write("Ensure openssl is installed and in your PATH.\n");
        process.exit(1);
      }
    });
}
