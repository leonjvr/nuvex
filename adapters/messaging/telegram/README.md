# Telegram Adapter

Connect SIDJUA to Telegram via the Bot API. Supports text messages,
document/photo attachments, reply threading, and MarkdownV2 formatting.

## Prerequisites

- A Telegram Bot token (get one from @BotFather: https://t.me/BotFather)

## Setup

1. Create a bot via @BotFather and copy the token
2. Store the token in SIDJUA:
   ```bash
   sidjua secrets set my-telegram-token <YOUR_BOT_TOKEN>
   ```
3. Add an instance to `governance/messaging.yaml`:
   ```yaml
   instances:
     - id: "my-telegram"
       adapter: "telegram"
       enabled: true
       config:
         bot_token_secret: "my-telegram-token"
       rate_limit_per_min: 10
   ```
4. Restart SIDJUA or run: `sidjua messaging reload`
5. Send a message to your bot on Telegram — SIDJUA will respond.

## Multiple Instances

Run multiple Telegram bots (e.g., per team or per project):

```yaml
instances:
  - id: "tg-support"
    adapter: "telegram"
    enabled: true
    config:
      bot_token_secret: "tg-support-token"
    rate_limit_per_min: 20
  - id: "tg-devops"
    adapter: "telegram"
    enabled: true
    config:
      bot_token_secret: "tg-devops-token"
    rate_limit_per_min: 10
```

Each instance is independent with its own token, rate limits, and user mappings.

## Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| bot_token_secret | yes | — | Secret name for Telegram Bot API token |
| allowed_chat_ids | no | [] | Restrict to specific chat IDs |
| drop_pending_updates | no | true | Skip offline messages on start |

## User Mapping

Map Telegram users to SIDJUA users:

```bash
sidjua messaging map my-telegram <telegram_user_id> <sidjua_user>
```

Find your Telegram user ID by sending /start to @userinfobot.

## Capabilities

- [x] Text messages
- [x] Document attachments
- [x] Photo attachments
- [x] Reply threading
- [x] MarkdownV2 formatting
- [x] Typing indicator
- [ ] Voice messages (planned V1.2)
- [ ] Video messages (planned V1.2)
- [ ] Inline keyboards (planned V1.2)

## Technical Details

- Uses long-polling (no webhook, no public URL needed)
- Library: telegraf (MIT license)
- Reconnects automatically on connection loss
