// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13d: `sidjua setup` CLI Command
 *
 * Interactive guided setup. Uses the SetupAssistant (Cloudflare Workers AI)
 * for recommendations; degrades gracefully to bundled docs when unavailable.
 *
 * Commands:
 *   sidjua setup               — show quick-start guide
 *   sidjua setup --ask <topic> — ask the setup assistant a question
 *   sidjua setup --validate    — validate current provider configuration
 *   sidjua setup --suggest     — get provider suggestions based on requirements
 */

import type { Command } from "commander";
import { SetupAssistant } from "../../setup/setup-assistant.js";
import { ProviderCatalog } from "../../providers/catalog.js";


export function registerSetupCommands(program: Command): void {
  const setupCmd = program
    .command("setup")
    .description("Interactive guided setup for SIDJUA")
    .option("--ask <topic>",   "Ask the setup assistant a question")
    .option("--validate",      "Validate current provider configuration")
    .option("--suggest",       "Get provider recommendations")
    .option("--budget <level>", "Budget level for suggestions: zero|low|standard|high", "standard")
    .option("--use-case <desc>", "Your use case for suggestions")
    .option("--local-only",    "Only suggest local/offline providers", false)
    .action(async (opts: {
      ask?:      string;
      validate?: boolean;
      suggest?:  boolean;
      budget:    string;
      useCase?:  string;
      localOnly: boolean;
    }) => {
      const assistant = new SetupAssistant();

      // --validate: check current provider config
      if (opts.validate) {
        await runValidate(assistant);
        return;
      }

      // --suggest: recommend providers
      if (opts.suggest) {
        await runSuggest(assistant, opts);
        return;
      }

      // --ask: direct question
      if (opts.ask) {
        await runAsk(assistant, opts.ask);
        return;
      }

      // Default: show quick-start guide
      const doc = assistant.loadDoc("quick-start");
      process.stdout.write(doc + "\n");
    });

  void setupCmd; // suppress unused warning
}


async function runAsk(assistant: SetupAssistant, topic: string): Promise<void> {
  process.stdout.write(`Asking setup assistant about: ${topic}\n\n`);
  const response = await assistant.ask({ topic });

  if (!response.fromAssistant) {
    process.stdout.write(`[Offline — showing ${response.docSection ?? "docs"} instead]\n\n`);
  }

  process.stdout.write(response.answer + "\n");
}

async function runValidate(assistant: SetupAssistant): Promise<void> {
  const catalog    = new ProviderCatalog();
  const providers  = catalog.getAll();
  const result     = assistant.validateProviderConfig(providers);

  if (result.valid && result.warnings.length === 0) {
    process.stdout.write("Provider configuration looks good.\n");
    return;
  }

  if (result.issues.length > 0) {
    process.stdout.write("Issues found:\n");
    for (const issue of result.issues) {
      process.stdout.write(`  [error] ${issue}\n`);
    }
  }

  if (result.warnings.length > 0) {
    process.stdout.write("Warnings:\n");
    for (const warning of result.warnings) {
      process.stdout.write(`  [warn] ${warning}\n`);
    }
  }

  if (!result.valid) {
    process.exit(1);
  }
}

async function runSuggest(
  assistant: SetupAssistant,
  opts: { budget: string; useCase?: string; localOnly: boolean },
): Promise<void> {
  const budget = opts.budget as "zero" | "low" | "standard" | "high";
  process.stdout.write("Getting provider recommendations...\n\n");

  const response = await assistant.suggestProviders({
    budget,
    localOnly: opts.localOnly,
    ...(opts.useCase !== undefined && { useCase: opts.useCase }),
  });

  if (!response.fromAssistant) {
    process.stdout.write(`[Offline — showing ${response.docSection ?? "docs"} instead]\n\n`);
  }

  process.stdout.write(response.answer + "\n");
}
