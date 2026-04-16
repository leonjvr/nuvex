# Local Docker Deploy Report (2026-04-16)

## Scope
- Source secrets restored from external export bundle.
- Local Docker stack deployed with profile `gateways`.
- PostgreSQL dump restored.
- Runtime health and logs validated.

## Deployment Result
- Current status: PARTIALLY SUCCESSFUL (core stack healthy)
- Healthy endpoints:
  - `GET /health` on brain: 200
  - `GET /api/health` on dashboard: 200
  - `GET /health` on gateway-wa: 200
  - `GET /health` on gateway-tg: 200 (bot in starting/disabled mode when token missing)
  - `GET /health` on gateway-email: 200

## Issues Found

### 1) Restored DB migration revision mismatch with codebase
- Severity: High
- Symptom:
  - Brain failed startup with `FAILED: Can't locate revision identified by '0024'`.
- Root cause:
  - Imported DB dump contained `alembic_version=0024`, but local migration chain head is `0016`.
- Mitigation applied:
  - Updated `alembic_version` in local DB to `0016` to match codebase migration head.
- Follow-up action:
  - Add a documented compatibility check between dump revision and repository migration head before restore.

### 2) WhatsApp gateway image build depended on host-side node_modules
- Severity: High (for first-time local deploy)
- Symptom:
  - `Dockerfile.gateway-wa` failed at `COPY src/gateway/whatsapp/node_modules ./node_modules`.
- Root cause:
  - Local repo did not include prebuilt `src/gateway/whatsapp/node_modules`.
- Mitigation applied:
  - Installed dependencies in `src/gateway/whatsapp` (`npm install`) before compose build.
- Follow-up action:
  - Replace host `node_modules` copy strategy with deterministic container install in Dockerfile.

### 3) Brain startup import mismatch
- Severity: High
- Symptom:
  - `ImportError: cannot import name '_build_claude_with_advisor' from 'src.brain.models_registry'`.
- Root cause:
  - `src/brain/nodes/call_llm.py` referenced advisor helper symbols absent from `src/brain/models_registry.py`.
- Mitigation applied:
  - Added missing helper functions in models registry:
    - `is_claude_model`
    - `_build_claude_with_advisor`
    - `get_advisor_enabled`
    - `make_advisor_tool`
- Follow-up action:
  - Add unit/import test for `call_llm` module load to catch symbol drift.

### 4) Email gateway failed when channel env file missing
- Severity: Medium
- Symptom:
  - `KeyError: 'IMAP_HOST'` in email poller module import.
- Root cause:
  - `config/channels.env` did not exist locally; gateway env vars were missing.
- Mitigation applied:
  - Created `config/channels.env` with required IMAP/SMTP keys.
  - Added `config/channels.env` to `.gitignore`.
- Follow-up action:
  - Improve startup guardrails to fail with friendly validation errors listing missing keys.

### 5) WhatsApp session instability (ongoing)
- Severity: Medium
- Symptom:
  - Repeated logs: `bad-request`, `stream:error conflict type=replaced`, disconnect/reconnect loops.
- Interpretation:
  - Likely concurrent WA session conflict or credential/session state contention.
- Current impact:
  - WA health endpoint still returns 200, but runtime is noisy and reconnecting.
- Follow-up action:
  - Ensure single active WA session for these credentials.
  - Consider clearing/re-pairing WA creds if conflict persists.

### 6) Telegram gateway token not configured
- Severity: Low
- Symptom:
  - Log indicates `TELEGRAM_BOT_TOKEN not set`; gateway health still available.
- Expected behavior:
  - Container starts in disabled mode for bot messaging.
- Follow-up action:
  - Add token in `config/channels.env` for active Telegram messaging.

### 7) Non-blocking deprecation warning
- Severity: Low
- Symptom:
  - FastAPI warning for `Query(..., regex=...)` deprecation in costs router.
- Follow-up action:
  - Replace `regex=` with `pattern=` in parameter declarations.

## Security / Repo Hygiene Changes
- Added/confirmed ignore rules for local sensitive artifacts:
  - `config/channels.env`
  - `nuvex-db-latest.sql`
  - `nuvex-db-*.sql`
  - `.secrets-backup-*/`
- Existing secret paths already ignored:
  - `.env` and `.secrets/*`
  - `data/wa-creds/` and `data/wa-qr.json`
  - `config/gh-config/hosts.yml`

## Notes
- This report captures what was observed and changed during local deployment validation.
- Remaining open runtime concerns are WA session conflict behavior and optional Telegram token setup.
