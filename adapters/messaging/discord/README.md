# Discord Adapter

Connect SIDJUA to Discord via the Gateway API. Supports text messages,
file attachments, thread replies, and Discord Markdown formatting.

## Prerequisites

1. A Discord application and bot at [discord.com/developers/applications](https://discord.com/developers/applications)
2. The **MessageContent** privileged intent enabled in the Bot settings
3. The bot invited to your server with `bot` scope and `Read Messages`, `Send Messages` permissions

> **Important:** MessageContent is a [privileged intent](https://discord.com/developers/docs/topics/gateway#privileged-intents).
> You must explicitly enable it in the Discord Developer Portal under Bot → Privileged Gateway Intents.
> Without it, `message.content` will always be empty.

## Setup

1. Create a bot and copy the token from the Developer Portal
2. Store the token:
   ```bash
   sidjua secrets set my-discord-token <YOUR_BOT_TOKEN>
   ```
3. Add an instance to `governance/messaging.yaml`:
   ```yaml
   instances:
     - id: "discord-main"
       adapter: "discord"
       enabled: true
       config:
         bot_token_secret: "my-discord-token"
       rate_limit_per_min: 20
   ```
4. Restart SIDJUA or run: `sidjua messaging reload`
5. Message your bot in Discord — SIDJUA will respond.

## Multiple Instances

Run multiple bots (e.g., one per guild or team):

```yaml
instances:
  - id: "discord-engineering"
    adapter: "discord"
    enabled: true
    config:
      bot_token_secret: "discord-eng-token"
      guild_ids: ["123456789012345678"]
    rate_limit_per_min: 30
  - id: "discord-support"
    adapter: "discord"
    enabled: true
    config:
      bot_token_secret: "discord-support-token"
      guild_ids: ["987654321098765432"]
    rate_limit_per_min: 10
```

## Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| bot_token_secret | yes | — | Secret name for Discord Bot token |
| guild_ids | no | [] | Restrict to specific guild IDs (empty = all guilds) |

## User Mapping

Map Discord user IDs to SIDJUA users:

```bash
sidjua messaging map discord-main <discord_user_id> <sidjua_user>
```

Find user IDs by enabling Developer Mode in Discord (Settings → Advanced → Developer Mode),
then right-clicking any user → Copy User ID.

## Capabilities

- [x] Text messages
- [x] File attachments (name, MIME type, size, URL)
- [x] Thread replies
- [x] Discord Markdown formatting
- [ ] Slash commands (planned V1.2)
- [ ] Emoji reactions (planned V1.2)
- [ ] Voice (not planned — audio only)

## Technical Details

- Uses Gateway API (WebSocket connection to Discord)
- Library: discord.js (Apache-2.0 license)
- Intents: Guilds, GuildMessages, MessageContent (privileged), DirectMessages
- Bot messages are automatically ignored to prevent loops
