// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: MessageToTaskBridge
 *
 * Orchestrates the full message → task pipeline:
 *   1. Authorization — sender must be a mapped SIDJUA user
 *   2. Override detection — reply to previous governance block
 *   3. Slash command delegation — starts with "/" (wired in P223)
 *   4. Task building — message text becomes task description 1:1 (no NLP)
 *   5. Governance check — injectable; default passes all
 *   6. Task submission — via ExecutionBridge
 *   7. Response routing — confirm or notify block to user
 */

import type {
  MessageEnvelope,
  UserTaskInput,
  BlockResult,
  AcceptResult,
  SubmitResult,
  TaskBridgeConfig,
} from "./types.js";
import type { TaskBuilder } from "./task-builder.js";
import type { OverrideManager } from "./override-manager.js";
import type { ResponseRouter } from "./response-router.js";
import type { UserMappingStore } from "./user-mapping.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("task-bridge");


export interface ExecutionBridgeLike {
  submitMessageTask(input: UserTaskInput): Promise<AcceptResult>;
}


/** Function that evaluates governance for a task input. */
export type GovernanceCheckFn =
  (input: UserTaskInput) => Promise<SubmitResult>;

/**
 * Fail-closed default: blocks all tasks when no governance evaluator is wired.
 * Wire a real GovernanceCheckFn before accepting messages in production.
 */
export const defaultGovernanceCheck: GovernanceCheckFn = async (_input) => ({
  blocked:      true,
  reason:       "No governance evaluator configured — task blocked (fail-closed default)",
  rule:         "NO_GOVERNANCE_EVALUATOR",
  overrideable: false,
});


export interface CommandHandler {
  handle(envelope: MessageEnvelope, user: { sidjua_user_id: string; role: string }): Promise<void>;
}


export class MessageToTaskBridge {
  private commandHandler?: CommandHandler;

  constructor(
    private readonly taskBuilder:      TaskBuilder,
    private readonly executionBridge:  ExecutionBridgeLike,
    private readonly responseRouter:   ResponseRouter,
    private readonly userMapping:      UserMappingStore,
    private readonly overrideManager:  OverrideManager,
    private readonly config:           TaskBridgeConfig,
    private readonly governanceCheck:  GovernanceCheckFn = defaultGovernanceCheck,
  ) {}

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  /**
   * Process an inbound message through the full pipeline.
   * Called by InboundMessageGateway (wired in P223).
   */
  async processMessage(envelope: MessageEnvelope): Promise<void> {
    // 1. Authorization
    const user = this.userMapping.lookupUser(envelope.instance_id, envelope.sender.platform_id);
    if (user === null) {
      logger.info("task-bridge", "Unauthorized sender", {
        metadata: {
          instance_id:     envelope.instance_id,
          platform_user_id: envelope.sender.platform_id,
        },
      });
      await this.responseRouter.sendUnauthorized(envelope);
      return;
    }

    // 2. Override response check
    if (this.overrideManager.isOverrideResponse(envelope)) {
      await this.overrideManager.processOverride(envelope, user);
      return;
    }

    // 3. Slash command delegation (handled in P223)
    if (envelope.content.text.startsWith("/")) {
      if (this.commandHandler !== undefined) {
        await this.commandHandler.handle(envelope, user);
      }
      return;
    }

    // 4. Build task — DIRECT PASS-THROUGH, no NLP
    const taskInput = this.taskBuilder.build(envelope, user);

    // 5. Governance check
    const govResult = await this.governanceCheck(taskInput);

    if (govResult.blocked) {
      const block = govResult as BlockResult;
      // Register for potential override
      this.overrideManager.registerBlock(envelope, user, taskInput, block);

      const windowMin = Math.floor(this.config.override.window_seconds / 60);
      const overrideHint = block.overrideable
        ? `\nAntworten Sie mit 'Freigabe erteilen' um zu übersteuern.\n(Gültig für ${windowMin} Minuten)`
        : "\nDiese Regel ist NICHT überschreibbar.";

      await this.responseRouter.sendBlocked(envelope, block.reason, block.rule, overrideHint);

      logger.info("task-bridge", "Task blocked by governance", {
        metadata: {
          rule:         block.rule,
          overrideable: block.overrideable,
          user_id:      user.sidjua_user_id,
        },
      });
      return;
    }

    // 6. Submit task
    const acceptResult = await this.executionBridge.submitMessageTask(taskInput);

    // 7. Confirm to user
    await this.responseRouter.sendTaskAccepted(envelope, acceptResult.handle, false);

    logger.info("task-bridge", "Task accepted", {
      metadata: { task_id: acceptResult.handle.id, user_id: user.sidjua_user_id },
    });
  }

  // ---------------------------------------------------------------------------
  // P223 wiring
  // ---------------------------------------------------------------------------

  /** Set the command handler. Called by P223 integration layer. */
  setCommandHandler(handler: CommandHandler): void {
    this.commandHandler = handler;
  }
}
