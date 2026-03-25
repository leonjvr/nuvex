# Messaging Adapter Developer Guide

This guide explains how to build a new messaging adapter for SIDJUA.

## Overview

A messaging adapter is a Node.js ES module that exports a `MessagingAdapterPlugin` as its default export.
SIDJUA discovers adapters by scanning subdirectories of `adapters/messaging/`.

Each adapter plugin can power many independent instances — for example, two Telegram bots with different tokens.

## Directory Layout

```
adapters/messaging/
  my-adapter/
    index.ts          ← adapter source (compiled to index.js)
    index.js          ← compiled output (imported at runtime)
    config.schema.json← JSON Schema for the config block in messaging.yaml
    README.md         ← end-user documentation
```

## Plugin Interface

```typescript
import type { MessagingAdapterPlugin } from "../../../src/messaging/adapter-plugin.js";

const plugin: MessagingAdapterPlugin = {
  meta: {
    name:         "my-adapter",    // unique name; used as adapter: key in messaging.yaml
    channel:      "my-channel",    // channel identifier embedded in every MessageEnvelope
    capabilities: ["text"],        // "text" | "attachments" | "threads" | "typing" | "rich_text"
    configSchema: {                // JSON Schema for config validation
      type:       "object",
      required:   ["api_key"],
      properties: {
        api_key: { type: "string" },
      },
    },
  },

  createInstance(instanceId, config, callbacks) {
    // Return an AdapterInstance — do NOT start the platform connection here.
    // start() is called separately by the InboundMessageGateway.
    return new MyAdapterInstance(instanceId, config, callbacks);
  },
};

export default plugin;
```

## AdapterInstance Interface

```typescript
class MyAdapterInstance implements AdapterInstance {
  readonly instanceId: string;
  readonly channel    = "my-channel";

  constructor(
    instanceId: string,
    private readonly config:    Record<string, unknown>,
    private readonly callbacks: AdapterCallbacks,
  ) {
    this.instanceId = instanceId;
  }

  async start(): Promise<void> {
    // Connect to the platform (open socket, start polling, etc.)
    // Register event handlers that call callbacks.onMessage(envelope).
  }

  async stop(): Promise<void> {
    // Gracefully disconnect from the platform.
    // Must not throw — catch errors internally.
  }

  isHealthy(): boolean {
    // Return true when the connection is live and messages can be sent/received.
    return this._connected;
  }

  async sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void> {
    // Send a response to a specific chat / user on the platform.
    // chatId corresponds to MessageEnvelope.metadata.chat_id.
  }

  formatText?(text: string): string {
    // Optional — transform markdown text to platform-native format.
    // Return text unchanged if no transformation is needed.
    return text;
  }
}
```

## callbacks.onMessage — Building a MessageEnvelope

Every inbound message must be converted to a `MessageEnvelope` and passed to `callbacks.onMessage`:

```typescript
const envelope: MessageEnvelope = {
  id:          crypto.randomUUID(),          // unique per message
  instance_id: this.instanceId,
  channel:     "my-channel",
  sender: {
    platform_id:  "user-123",               // stable platform user ID
    display_name: "Alice",
    verified:     false,                     // true only when platform verifies identity
  },
  content: {
    text:        "Hello!",
    attachments: [],                         // omit if none
    reply_to:    "orig-msg-id",             // omit if not a reply
  },
  metadata: {
    timestamp:    new Date().toISOString(),
    chat_id:      "chat-456",               // used to route sendResponse()
    thread_id:    "thread-789",             // omit if platform has no threads
    platform_raw: rawPlatformMessage,       // original payload (for debugging)
  },
};

await callbacks.onMessage(envelope);
```

## callbacks.getSecret — Fetching Secrets

Never store tokens in plain text in `messaging.yaml`. Instead, store a secret name and resolve it:

```typescript
// In messaging.yaml:
// config:
//   bot_token_secret: "my-telegram-bot-token"

const token = await callbacks.getSecret(config["bot_token_secret"] as string);
```

## Error Handling Rules

- `start()` may throw — the gateway catches and logs the error, then marks the instance as unhealthy.
- `stop()` must NOT throw — catch all errors internally.
- `sendResponse()` may throw — the ResponseRouter handles failures gracefully.
- Errors in `callbacks.onMessage` are caught by the InboundMessageGateway; do not handle them yourself.

## Logger Usage

The `callbacks.logger` has a two-argument form:

```typescript
// ✅ Correct — event string then message string
callbacks.logger.info("my_adapter_started", `Instance ${this.instanceId} connected`);
callbacks.logger.warn("my_adapter_reconnect", "Lost connection — retrying");
callbacks.logger.error("my_adapter_error", `Failed to send: ${e.message}`);

// ❌ Wrong — single-argument form
callbacks.logger.info("connected");
```

## Config Schema

Provide a JSON Schema in `config.schema.json`. Required fields are validated before `createInstance` is called.
Use secret-name fields (e.g. `bot_token_secret`) instead of raw token fields so users never store secrets in YAML.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["bot_token_secret"],
  "properties": {
    "bot_token_secret": {
      "type": "string",
      "description": "Name of the secret containing the bot API token"
    }
  }
}
```

## Config Entry in messaging.yaml

```yaml
instances:
  - id: "my-instance-1"
    adapter: "my-adapter"
    enabled: true
    config:
      bot_token_secret: "my-secret-name"
    rate_limit_per_min: 30
```

## Capabilities

Declare capabilities your adapter supports in `meta.capabilities`:

| Capability   | Meaning                                              |
|-------------|------------------------------------------------------|
| `text`      | Can send and receive plain text messages             |
| `attachments` | Can receive file attachments (URL-based)           |
| `threads`   | Supports threaded replies (thread_id in envelope)    |
| `typing`    | Can send "typing…" indicators                        |
| `rich_text` | Supports markdown / rich formatting in responses     |

## Testing

Write tests in `tests/messaging/adapters/<your-adapter>.test.ts`.

- Mock the platform library entirely — no real API calls in unit tests.
- Test each lifecycle phase: `createInstance` → `start` → message handler → `sendResponse` → `stop`.
- Use `vi.mock()` at the top of the test file, before any adapter imports.

See `tests/messaging/adapters/telegram.test.ts` for a complete example.

## Available Adapters

| Adapter    | Channel     | Dependencies       |
|-----------|------------|-------------------|
| discord   | discord     | discord.js         |
| slack     | slack       | @slack/bolt        |
| whatsapp  | whatsapp    | baileys            |
| websocket | websocket   | ws (built-in)      |
| telegram  | telegram    | telegraf           |
| email     | email       | imapflow, nodemailer |
