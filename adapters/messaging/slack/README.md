# Slack Adapter

Connect SIDJUA to Slack using Socket Mode. Supports direct messages,
channel messages, app mentions, file attachments, and threaded replies.
Socket Mode requires no public URL — all connections are outbound.

## Prerequisites

1. A Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Socket Mode enabled (App Settings → Socket Mode → Enable)
3. An App-Level Token with `connections:write` scope
4. Bot Token Scopes: `chat:write`, `channels:history`, `app_mentions:read`, `im:history`, `files:read`
5. Bot subscribed to events: `message.channels`, `message.im`, `app_mention`

## Setup

1. Create a Slack app and generate tokens:
   - Bot Token (xoxb-...): OAuth & Permissions → Bot Token
   - App Token (xapp-...): App Settings → Basic Information → App-Level Tokens
2. Store both tokens:
   ```bash
   sidjua secrets set slack-bot-token xoxb-your-token
   sidjua secrets set slack-app-token xapp-your-token
   ```
3. Add an instance to `governance/messaging.yaml`:
   ```yaml
   instances:
     - id: "slack-workspace"
       adapter: "slack"
       enabled: true
       config:
         bot_token_secret: "slack-bot-token"
         app_token_secret: "slack-app-token"
       rate_limit_per_min: 20
   ```
4. Restart SIDJUA or run: `sidjua messaging reload`

## Multiple Instances

Connect to multiple Slack workspaces simultaneously:

```yaml
instances:
  - id: "slack-engineering"
    adapter: "slack"
    enabled: true
    config:
      bot_token_secret: "slack-eng-bot-token"
      app_token_secret: "slack-eng-app-token"
    rate_limit_per_min: 30
  - id: "slack-customers"
    adapter: "slack"
    enabled: true
    config:
      bot_token_secret: "slack-cust-bot-token"
      app_token_secret: "slack-cust-app-token"
    rate_limit_per_min: 10
```

Each instance connects to a separate Slack workspace.

## Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| bot_token_secret | yes | — | Secret name for Slack Bot Token (xoxb-...) |
| app_token_secret | yes | — | Secret name for Slack App Token (xapp-...) |

## User Mapping

Map Slack user IDs to SIDJUA users:

```bash
sidjua messaging map slack-workspace <slack_user_id> <sidjua_user>
```

Find user IDs in Slack: click a user → View Profile → More (⋯) → Copy member ID.

## Capabilities

- [x] Text messages (direct + channel)
- [x] App mentions (@SIDJUA in channels)
- [x] File attachments
- [x] Thread replies
- [x] Slack mrkdwn formatting
- [x] Typing indicator
- [ ] Interactive components (planned V1.2)
- [ ] Slash commands (planned V1.2)

## Technical Details

- Uses Socket Mode (WebSocket connection, no public URL required)
- Library: @slack/bolt (MIT license)
- System messages (subtypes) are automatically filtered out
- App mentions automatically strip the `<@BOT_ID>` prefix before processing
