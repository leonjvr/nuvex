# WebSocket Adapter

Built-in bidirectional WebSocket server for GUI (PWA) and custom client integration.
Ideal for the SIDJUA web interface, browser extensions, and automation scripts.
No external service required — the WebSocket server runs inside SIDJUA.

## Use Cases

- **SIDJUA GUI (PWA)**: The web interface connects to this adapter for real-time messaging
- **Custom scripts**: Shell scripts or cron jobs that send messages and receive responses
- **CI/CD integration**: Trigger SIDJUA agents from pipelines and receive structured output
- **Automation**: Any custom client that speaks WebSocket + JSON

## Protocol

### Client → Server (inbound message)

```json
{
  "text": "Your message here",
  "reply_to": "optional-message-id",
  "thread_id": "optional-thread-id",
  "attachments": [
    { "filename": "file.txt", "mime_type": "text/plain", "size_bytes": 1024 }
  ]
}
```

### Server → Client (response)

```json
{
  "type": "response",
  "text": "SIDJUA's response",
  "reply_to": "optional-original-message-id",
  "format": "text"
}
```

## Setup

1. Add an instance to `governance/messaging.yaml`:
   ```yaml
   instances:
     - id: "ws-gui"
       adapter: "websocket"
       enabled: true
       config:
         port: 4201
         auth_mode: "token"
         auth_token: "my-secret-ws-token"
       rate_limit_per_min: 60
   ```
2. Restart SIDJUA or run: `sidjua messaging reload`
3. Connect via WebSocket: `ws://localhost:4201?token=my-secret-ws-token`

## JavaScript Client Example

```javascript
const ws = new WebSocket("ws://localhost:4201?token=my-secret-ws-token");

ws.onopen = () => {
  ws.send(JSON.stringify({ text: "Hello SIDJUA!" }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log("SIDJUA says:", response.text);
};
```

## Authentication

When `auth_mode: "token"`, clients must supply the token as a URL query parameter:
```
ws://localhost:4201?token=<auth_token>
```

Connections without a valid token are closed immediately with code 4001.

Set `auth_mode: "none"` to disable authentication (only for local/trusted networks).

## Multiple Instances

Run multiple WebSocket servers on different ports for different access levels:

```yaml
instances:
  - id: "ws-public"
    adapter: "websocket"
    config:
      port: 4201
      auth_mode: "token"
      auth_token: "public-token"
    rate_limit_per_min: 20
  - id: "ws-admin"
    adapter: "websocket"
    config:
      port: 4202
      auth_mode: "token"
      auth_token: "admin-secret-token"
    rate_limit_per_min: 120
```

## Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| port | no | 4201 | WebSocket server port |
| auth_mode | no | "token" | "token" (URL query param) or "none" (no auth) |
| auth_token | no | — | Token clients must supply when auth_mode=token |

## User Mapping

Each WebSocket connection gets a unique session ID as its platform_id.
Map persistent users if your client sends a stable identity:

```bash
sidjua messaging map ws-gui <session_id> alice
```

## Capabilities

- [x] Text messages
- [x] JSON attachment metadata
- [ ] Binary file transfer (planned V1.2)
- [ ] Multiplexed channels (planned V1.2)

## Technical Details

- Library: ws (MIT license, included with Node.js ecosystem)
- Each connection gets a UUID session ID
- Disconnected clients are automatically removed from the session map
- Messages with empty or non-string `text` fields are silently dropped
