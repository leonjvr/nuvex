// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: Messaging Adapter Plugin SDK
 *
 * This is the public SDK contract. Every messaging adapter must implement
 * MessagingAdapterPlugin and export it as the default export of its index.ts.
 *
 * To create a custom adapter:
 *   1. Create a directory under adapters/messaging/<your-adapter>/
 *   2. Implement MessagingAdapterPlugin in index.ts and export as default
 *   3. Define your config JSON Schema in config.schema.json
 *   4. Document setup in README.md
 *   5. Register an instance in governance/messaging.yaml
 *
 * SIDJUA auto-discovers adapters on startup and on `sidjua messaging adapter reload`.
 * No code changes required to the core — adapters are truly plug-and-play.
 */

import type { MessagingChannel, MessageEnvelope, ResponseOptions } from "./types.js";
import type { Logger } from "../core/logger.js";

export type { MessagingChannel, MessageEnvelope, ResponseOptions };
export type { Logger };


/**
 * Capability tags an adapter can declare in its meta.
 * Used by the gateway to determine what features are available.
 */
export type AdapterCapability =
  | "text"          // can send/receive plain text
  | "attachments"   // can send/receive file attachments
  | "threads"       // supports threaded / reply conversations
  | "reactions"     // supports emoji reactions to messages
  | "typing"        // can display a "typing…" indicator
  | "rich_text"     // supports formatted text (Markdown, HTML)
  | "read_receipts"; // can mark messages as read


/**
 * Static descriptor for an adapter plugin.
 * Returned via MessagingAdapterPlugin.meta — one per adapter type.
 */
export interface AdapterMeta {
  /** Adapter identifier — must match the directory name, e.g. "telegram". */
  name:         string;
  /** Semantic version of the adapter, e.g. "1.0.0". */
  version:      string;
  /** Human-readable description shown in `sidjua messaging list`. */
  description:  string;
  /**
   * Channel identifier embedded in every MessageEnvelope this adapter produces.
   * Must be stable across versions, e.g. "telegram", "email".
   */
  channel:      MessagingChannel;
  author?:      string;
  homepage?:    string;
  /** JSON Schema (draft-07) for the instance config block. */
  configSchema: object;
  capabilities: AdapterCapability[];
}


/**
 * Callbacks injected into the adapter on creation.
 * Adapters use these for all interactions with SIDJUA internals.
 */
export interface AdapterCallbacks {
  /** Called when the adapter receives an inbound message. */
  onMessage: (msg: MessageEnvelope) => Promise<void>;
  /**
   * Retrieve a secret from SIDJUA's secret store by name.
   * Adapters should store credentials as secret keys, never raw values.
   */
  getSecret: (key: string) => Promise<string>;
  /** SIDJUA logger — use instead of console.log. */
  logger:    Logger;
}


/**
 * A running instance of an adapter connected to a specific account/bot/inbox.
 * Created by MessagingAdapterPlugin.createInstance().
 * start() must be called before the instance can receive or send messages.
 */
export interface AdapterInstance {
  readonly instanceId: string;
  readonly channel:    MessagingChannel;

  /** Connect to the platform and begin listening for messages. */
  start(): Promise<void>;

  /** Disconnect from the platform. Called on shutdown or hot-remove. */
  stop(): Promise<void>;

  /** Send a response message to a chat. */
  sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void>;

  /** Return true if the underlying connection is healthy. */
  isHealthy(): boolean;

  /**
   * Optional: format text for this platform's conventions.
   * ResponseRouter calls this before sending — e.g. to escape Markdown.
   */
  formatText?(text: string): string;
}


/**
 * The top-level interface every adapter module must export as `default`.
 *
 * Example minimal adapter:
 * ```typescript
 * import type { MessagingAdapterPlugin } from "../../src/messaging/adapter-plugin.js";
 *
 * const plugin: MessagingAdapterPlugin = {
 *   meta: {
 *     name: "my-adapter",
 *     version: "1.0.0",
 *     description: "My custom adapter",
 *     channel: "my-platform",
 *     configSchema: { type: "object", required: ["api_key_secret"], properties: { ... } },
 *     capabilities: ["text"],
 *   },
 *   createInstance(instanceId, config, callbacks) {
 *     return {
 *       instanceId,
 *       channel: "my-platform",
 *       async start() { /* connect * / },
 *       async stop()  { /* disconnect * / },
 *       async sendResponse(chatId, text) { /* send * / },
 *       isHealthy() { return true; },
 *     };
 *   },
 * };
 * export default plugin;
 * ```
 */
export interface MessagingAdapterPlugin {
  /** Static adapter metadata. */
  readonly meta: AdapterMeta;

  /**
   * Factory: create one instance of this adapter with the given runtime config.
   *
   * Called by AdapterRegistry after config validation succeeds.
   * The returned instance is NOT yet started — call instance.start() separately.
   *
   * @param instanceId  Unique instance ID from governance/messaging.yaml
   * @param config      Validated adapter-specific config block
   * @param callbacks   SIDJUA callbacks for messaging + secrets + logging
   */
  createInstance(
    instanceId: string,
    config:     Record<string, unknown>,
    callbacks:  AdapterCallbacks,
  ): AdapterInstance;
}
