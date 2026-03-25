# Email Adapter

Connect SIDJUA to any email account via IMAP (inbound) and SMTP (outbound).
Works with Gmail, Outlook, Mailcow, Posteo, or any standard email provider.

## Prerequisites

- An email account with IMAP and SMTP access
- IMAP IDLE support (most modern providers support this)

## Setup

1. Store your email credentials:
   ```bash
   sidjua secrets set email-imap-host "imap.example.com"
   sidjua secrets set email-imap-user "bot@example.com"
   sidjua secrets set email-imap-pass "your-password"
   sidjua secrets set email-smtp-host "smtp.example.com"
   sidjua secrets set email-smtp-user "bot@example.com"
   sidjua secrets set email-smtp-pass "your-password"
   ```
2. Add an instance to `governance/messaging.yaml`:
   ```yaml
   instances:
     - id: "support-inbox"
       adapter: "email"
       enabled: true
       config:
         imap_host_secret: "email-imap-host"
         imap_user_secret: "email-imap-user"
         imap_pass_secret: "email-imap-pass"
         smtp_host_secret: "email-smtp-host"
         smtp_user_secret: "email-smtp-user"
         smtp_pass_secret: "email-smtp-pass"
         from_address: "bot@example.com"
       rate_limit_per_min: 5
   ```
3. Restart SIDJUA or run: `sidjua messaging reload`

## Multiple Instances

Monitor multiple email accounts (support inbox + alerts inbox):

```yaml
instances:
  - id: "support-inbox"
    adapter: "email"
    enabled: true
    config:
      imap_host_secret: "support-imap-host"
      imap_user_secret: "support-imap-user"
      imap_pass_secret: "support-imap-pass"
      smtp_host_secret: "support-smtp-host"
      smtp_user_secret: "support-smtp-user"
      smtp_pass_secret: "support-smtp-pass"
      from_address: "support@example.com"
    rate_limit_per_min: 5
  - id: "alerts-inbox"
    adapter: "email"
    enabled: true
    config:
      imap_host_secret: "alerts-imap-host"
      imap_user_secret: "alerts-imap-user"
      imap_pass_secret: "alerts-imap-pass"
      smtp_host_secret: "alerts-smtp-host"
      smtp_user_secret: "alerts-smtp-user"
      smtp_pass_secret: "alerts-smtp-pass"
      from_address: "alerts@example.com"
      mailbox: "Alerts"
    rate_limit_per_min: 2
```

Each instance monitors a separate mailbox with its own credentials and rate limits.

## Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| imap_host_secret | yes | — | Secret: IMAP hostname |
| imap_user_secret | yes | — | Secret: IMAP username |
| imap_pass_secret | yes | — | Secret: IMAP password |
| imap_port | no | 993 | IMAP port |
| imap_tls | no | true | Use TLS for IMAP |
| smtp_host_secret | yes | — | Secret: SMTP hostname |
| smtp_user_secret | yes | — | Secret: SMTP username |
| smtp_pass_secret | yes | — | Secret: SMTP password |
| smtp_port | no | 587 | SMTP port |
| smtp_tls | no | true | Use TLS for SMTP |
| from_address | yes | — | Sender address for outbound email |
| response_subject | no | "SIDJUA Response" | Subject for reply emails |
| mailbox | no | "INBOX" | IMAP mailbox to monitor |

## User Mapping

Map email addresses to SIDJUA users:

```bash
sidjua messaging map support-inbox user@example.com alice
```

When `require_mapping: true` is set in governance, only mapped senders receive responses.

## Capabilities

- [x] Text messages (plain text + HTML stripping)
- [x] Reply threading (In-Reply-To / References headers)
- [x] HTML formatted responses
- [ ] Attachment forwarding (planned V1.2)
- [ ] Multiple mailbox monitoring per instance (planned V1.2)

## Technical Details

- Inbound: IMAP IDLE (real-time push, no polling)
- Outbound: SMTP
- Libraries: imapflow (MIT), nodemailer (MIT)
- Unseen messages from before startup are processed on connect
- All processed messages are marked as Seen in the mailbox
