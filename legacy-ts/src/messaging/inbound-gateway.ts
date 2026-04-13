// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: InboundMessageGateway
 *
 * Central ingress point for all inbound messages from adapter instances.
 *
 * Responsibilities:
 *   1. Authorization — check UserMappingStore per instance + sender
 *   2. Rate limiting — per sender per instance (sliding window, in-memory)
 *   3. Global governance — max_inbound_per_hour across all instances
 *   4. Fan-out — call all registered message handlers in sequence
 *   5. Lifecycle — start/stop adapter instances via AdapterRegistry
 *   6. Hot plug — add/remove instances at runtime
 */

import type { AdapterRegistry } from "./adapter-registry.js";
import type { UserMappingStore }  from "./user-mapping.js";
import type { AdapterInstanceConfig, MessageEnvelope, MessagingGovernance } from "./types.js";
import type { AdapterCallbacks } from "./adapter-plugin.js";
import { createLogger } from "../core/logger.js";


/** Downstream consumer of authorized inbound messages. */
export interface MessageProcessor {
  processMessage(envelope: MessageEnvelope): Promise<void>;
}

const logger = createLogger("inbound-gateway");


export class InboundMessageGateway {
  private readonly handlers: ((msg: MessageEnvelope) => Promise<void>)[] = [];

  /**
   * Rate limit state: key = `${instanceId}:${platformId}`, value = timestamps (ms).
   * Entries older than 60 s are purged on each check.
   */
  private readonly rateLimiter = new Map<string, number[]>();

  /** Per-instance rate limit (messages/min). Populated by addInstance/start. */
  private readonly instanceLimits = new Map<string, number>();

  /** Default per-instance rate limit when no explicit limit is configured. */
  static readonly DEFAULT_RATE_LIMIT_PER_MIN = 10;

  /**
   * Global inbound counter: timestamps of all accepted messages.
   * Used to enforce governance.max_inbound_per_hour.
   */
  private globalTimestamps: number[] = [];

  constructor(
    private readonly registry:    AdapterRegistry,
    private readonly userMapping: UserMappingStore,
    private readonly governance:  MessagingGovernance,
    private readonly getSecretFn: (key: string) => Promise<string> = async () => {
      throw new Error("No secrets manager configured");
    },
    messageProcessor?: MessageProcessor,
  ) {
    if (messageProcessor !== undefined) {
      this.onMessage((msg) => messageProcessor.processMessage(msg));
    }
  }

  // ---------------------------------------------------------------------------
  // Handler registration
  // ---------------------------------------------------------------------------

  /**
   * Register a handler that will be called for every authorized inbound message.
   * Handlers are called sequentially in registration order.
   */
  onMessage(handler: (msg: MessageEnvelope) => Promise<void>): void {
    this.handlers.push(handler);
  }

  // ---------------------------------------------------------------------------
  // Message processing
  // ---------------------------------------------------------------------------

  /** Process one inbound message through authorization + rate limiting + handlers. */
  async handleInboundMessage(msg: MessageEnvelope): Promise<void> {
    logger.info("inbound-gateway", "Message received", {
      metadata: {
        event:       "MESSAGE_RECEIVED" as const,
        instance_id: msg.instance_id,
        sender_id:   msg.sender.platform_id,
        channel:     msg.channel,
      },
    });

    // 1. Authorization
    if (this.governance.require_mapping) {
      const authorized = this.userMapping.isAuthorized(msg.instance_id, msg.sender.platform_id);
      if (!authorized) {
        logger.warn("inbound-gateway", "Message rejected — unauthorized sender", {
          metadata: {
            event:       "MESSAGE_REJECTED_UNAUTHORIZED" as const,
            instance_id: msg.instance_id,
            sender_id:   msg.sender.platform_id,
          },
        });
        return;
      }
    }

    logger.info("inbound-gateway", "Message authorized", {
      metadata: {
        event:       "MESSAGE_AUTHORIZED" as const,
        instance_id: msg.instance_id,
        sender_id:   msg.sender.platform_id,
      },
    });

    // 2. Per-sender rate limit (per-instance)
    const key    = `${msg.instance_id}:${msg.sender.platform_id}`;
    const limitConfig = this._instanceRateLimit(msg.instance_id);
    if (limitConfig > 0 && this._isRateLimited(key, limitConfig)) {
      logger.warn("inbound-gateway", "Message rejected — rate limit", {
        metadata: {
          event:       "MESSAGE_REJECTED_RATE_LIMIT" as const,
          instance_id: msg.instance_id,
          sender_id:   msg.sender.platform_id,
        },
      });
      return;
    }

    // 3. Global inbound limit
    if (this.governance.max_inbound_per_hour > 0 && this._isGlobalLimited()) {
      logger.warn("inbound-gateway", "Message rejected — global rate limit", {
        metadata: {
          event:     "MESSAGE_REJECTED_GOVERNANCE" as const,
          sender_id: msg.sender.platform_id,
        },
      });
      return;
    }

    this._recordGlobal();

    // 4. Fan-out to handlers
    for (const handler of this.handlers) {
      try {
        await handler(msg);
      } catch (e: unknown) {
        logger.warn("inbound-gateway", "Message handler error", {
          metadata: {
            instance_id: msg.instance_id,
            error:       e instanceof Error ? e.message : String(e),
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Discover adapters, then create and start all enabled instances.
   * The gateway injects itself as the onMessage callback so all messages
   * flow through handleInboundMessage.
   */
  async start(configs: AdapterInstanceConfig[]): Promise<void> {
    await this.registry.discoverAdapters();

    // Store per-instance rate limits before starting adapters
    for (const cfg of configs) {
      const limit = cfg.rate_limit_per_min ?? InboundMessageGateway.DEFAULT_RATE_LIMIT_PER_MIN;
      this.instanceLimits.set(cfg.id, limit);
    }

    const callbacks: Partial<AdapterCallbacks> = {
      onMessage: (msg) => this.handleInboundMessage(msg),
      getSecret: this.getSecretFn,
      logger:    logger,
    };

    await this.registry.startAll(configs, callbacks);
  }

  /** Stop all adapter instances gracefully. */
  async stop(): Promise<void> {
    await this.registry.stopAll();
  }

  // ---------------------------------------------------------------------------
  // Runtime hot plug
  // ---------------------------------------------------------------------------

  /** Create and start a new adapter instance at runtime. */
  async addInstance(config: AdapterInstanceConfig): Promise<void> {
    const limit = config.rate_limit_per_min ?? InboundMessageGateway.DEFAULT_RATE_LIMIT_PER_MIN;
    this.instanceLimits.set(config.id, limit);
    const callbacks: AdapterCallbacks = {
      onMessage: (msg) => this.handleInboundMessage(msg),
      getSecret: this.getSecretFn,
      logger:    logger,
    };
    await this.registry.createInstance(config, callbacks);
    await this.registry.startInstance(config.id);
  }

  /** Stop and remove an adapter instance at runtime. */
  async removeInstance(instanceId: string): Promise<void> {
    this.instanceLimits.delete(instanceId);
    await this.registry.removeInstance(instanceId);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Look up the rate_limit_per_min for the given instance. */
  private _instanceRateLimit(instanceId: string): number {
    return this.instanceLimits.get(instanceId) ?? InboundMessageGateway.DEFAULT_RATE_LIMIT_PER_MIN;
  }

  /** True when the sender has exceeded rate_limit_per_min within the last 60 s. */
  private _isRateLimited(key: string, limitPerMin: number): boolean {
    const now    = Date.now();
    const cutoff = now - 60_000;
    const times  = (this.rateLimiter.get(key) ?? []).filter((t) => t > cutoff);
    if (times.length >= limitPerMin) return true;
    times.push(now);
    this.rateLimiter.set(key, times);
    return false;
  }

  /** True when the global hourly limit has been reached. */
  private _isGlobalLimited(): boolean {
    const cutoff = Date.now() - 3_600_000;
    this.globalTimestamps = this.globalTimestamps.filter((t) => t > cutoff);
    return this.globalTimestamps.length >= this.governance.max_inbound_per_hour;
  }

  private _recordGlobal(): void {
    this.globalTimestamps.push(Date.now());
  }

  /**
   * Override the rate limit for a specific key (used in tests).
   * @internal
   */
  _setRateLimitEntries(key: string, timestamps: number[]): void {
    this.rateLimiter.set(key, timestamps);
  }
}
