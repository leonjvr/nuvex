# WhatsApp Adapter

Connect SIDJUA to WhatsApp using the baileys library (WhatsApp Web client).
Authenticate once via QR code; subsequent restarts reconnect automatically.

## ⚠️ Important Disclaimer

**baileys is an unofficial, reverse-engineered WhatsApp Web client.** It is not
endorsed by or affiliated with Meta Platforms, Inc. Using unofficial clients may
violate WhatsApp's Terms of Service. WhatsApp may restrict or ban accounts that
use unofficial clients.

**Use this adapter at your own risk.** For production enterprise deployments,
consider the official [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
which requires Meta Business verification but provides official support.

## Prerequisites

- A WhatsApp account (personal or Business)
- Terminal access to scan the QR code on first run
- A writable, persistent directory for auth state storage

## Setup

1. Add an instance to `governance/messaging.yaml`:
   ```yaml
   instances:
     - id: "whatsapp-main"
       adapter: "whatsapp"
       enabled: true
       config:
         auth_dir: "./data/whatsapp-auth"
         print_qr_terminal: true
       rate_limit_per_min: 5
   ```
2. Start SIDJUA — a QR code will appear in the terminal
3. Open WhatsApp on your phone → Linked Devices → Link a Device
4. Scan the QR code
5. SIDJUA connects and saves auth state to `auth_dir`

Subsequent restarts reuse the saved auth state — no QR scan needed unless logged out.

## Multiple Instances

Run multiple WhatsApp accounts (e.g., personal + business):

```yaml
instances:
  - id: "whatsapp-personal"
    adapter: "whatsapp"
    enabled: true
    config:
      auth_dir: "./data/whatsapp-personal"
    rate_limit_per_min: 5
  - id: "whatsapp-business"
    adapter: "whatsapp"
    enabled: true
    config:
      auth_dir: "./data/whatsapp-business"
    rate_limit_per_min: 10
```

Each instance requires a separate QR scan and maintains its own auth state directory.

## Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| auth_dir | yes | — | Directory for WhatsApp auth state (must be writable, persistent) |
| print_qr_terminal | no | true | Show QR code in terminal for authentication |

## User Mapping

Map WhatsApp phone numbers to SIDJUA users:

```bash
sidjua messaging map whatsapp-main 15551234567 alice
```

Platform IDs are phone numbers without the `@s.whatsapp.net` suffix.

## Capabilities

- [x] Text messages
- [x] Quote replies (reply_to)
- [ ] Images and videos (planned V1.2)
- [ ] Audio messages (planned V1.2)
- [ ] Document attachments (planned V1.2)
- [ ] Group messages (planned V1.2)

## Enterprise Alternative

For production use without unofficial clients, use the
[WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/):
- Official Meta product with SLA
- Requires Meta Business verification (free for verified businesses)
- Webhook-based (requires public HTTPS endpoint)
- A future SIDJUA adapter (P-future) will support this

## Technical Details

- Library: baileys (MIT license)
- Connection: WhatsApp Web protocol (multi-device)
- Auth: multi-file auth state (JSON files in `auth_dir`)
- Auto-reconnects on non-logout disconnects
- Own messages (`fromMe=true`) are automatically ignored
