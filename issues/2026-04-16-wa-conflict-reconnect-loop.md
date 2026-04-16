# WA Gateway Conflict Reconnect Loop (Local Docker)

## Summary
Local gateway-wa stays reachable but repeatedly reconnects due to WhatsApp stream conflict and init-query bad-request errors.

## Environment
- Date: 2026-04-16
- Stack: docker compose local with profile gateways
- Service: gateway-wa (port 9101)

## Observed Symptoms
- Health endpoint returns OK: `GET http://127.0.0.1:9101/health` => 200
- Logs repeatedly show:
  - `unexpected error in 'init queries'` with `Error: bad-request`
  - `stream:error` with `conflict` and `type=replaced`
  - disconnect code `440`
  - reconnect loop every few seconds

## Impact
- Gateway is technically up, but session stability is degraded.
- Message handling may be unreliable during reconnect churn.

## Likely Cause
- Competing WhatsApp session/login for the same credentials/device state.
- Potential stale or duplicated auth state in creds if same account is active elsewhere.

## Repro
1. Start local stack with gateways profile.
2. Observe gateway-wa logs for 1-2 minutes.
3. See repeated conflict/reconnect entries.

## Workarounds
- Ensure only one active WA Web/Baileys session for this account.
- Stop other devices/sessions using the same WA creds.
- If needed, clear and re-pair `data/wa-creds` for a clean session.

## Proposed Fixes
- Add explicit handling/telemetry for conflict `type=replaced` with clearer operator guidance.
- Consider backoff strategy tuned for session-conflict errors.
- Add admin endpoint/command to reset WA session state safely.

## Acceptance Criteria
- gateway-wa maintains stable connection for >= 10 minutes without repeated `conflict` disconnects.
- No repeated `unexpected error in 'init queries'` during normal startup.
