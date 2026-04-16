## 1. Infrastructure

- [ ] 1.1 Create `src/gateway/voice/` Python package and `src/gateway/voice/main.py` FastAPI app entry point
- [ ] 1.2 Create `Dockerfile.gateway-voice` based on Python 3.12-slim; add `twilio`, `openai`, `fastapi`, `httpx`, `websockets` deps
- [ ] 1.3 Add `gateway-voice` service to `docker-compose.local.yml` on port `9104`
- [ ] 1.4 Write Alembic migration to create `voice_calls` table (`call_sid`, `agent_id`, `thread_id`, `caller_number`, `started_at`, `ended_at`, `duration_seconds`, `turn_count`)
- [ ] 1.5 Add voice env vars to `config/channels.env.example`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `OPENAI_WHISPER_API_KEY`, `OPENAI_TTS_API_KEY`, `VOICE_SILENCE_THRESHOLD_MS`

## 2. Inbound Call Handler

- [ ] 2.1 Implement `POST /voice/inbound` TwiML webhook: validate Twilio signature; check agent `voice_enabled` and `voice_allowlist`; respond with `<Connect><Stream>` TwiML
- [ ] 2.2 Implement `POST /voice/status` callback endpoint: update `voice_calls` row on call completion
- [ ] 2.3 Implement caller allowlist check from `divisions.yaml` `voice_allowlist` per agent
- [ ] 2.4 Implement rejection TwiML response (polite message + `<Hangup>`) for disabled agents and blocked callers

## 3. WebSocket Media Stream

- [ ] 3.1 Implement `/voice/stream` WebSocket endpoint: accept Twilio media stream connection
- [ ] 3.2 Accumulate µ-law audio chunks and convert to 16 kHz WAV using `audioop` or `soundfile`
- [ ] 3.3 Implement energy-based VAD: when 1000ms of silence detected, extract buffered audio for STT
- [ ] 3.4 `VOICE_SILENCE_THRESHOLD_MS` env var controls silence duration (default: 1000)

## 4. STT Pipeline

- [ ] 4.1 Create `src/gateway/voice/stt.py`: `transcribe(audio_bytes: bytes) -> str` function
- [ ] 4.2 Implement Whisper API call using `openai` SDK; fail-fast at startup if no key configured
- [ ] 4.3 Unit tests for STT: mock OpenAI client, assert correct API parameters and return value

## 5. TTS Pipeline

- [ ] 5.1 Create `src/gateway/voice/tts.py`: `synthesise(text: str, voice: str) -> bytes` function
- [ ] 5.2 Implement OpenAI TTS API call using `openai` SDK; return MP3 bytes
- [ ] 5.3 Implement per-agent `tts_voice` config read from `divisions.yaml` (default: `"alloy"`)
- [ ] 5.4 Unit tests for TTS: mock OpenAI client, assert voice parameter passed correctly

## 6. Brain Integration

- [ ] 6.1 On call connect: create brain thread via `POST /api/threads` with `channel = "voice"` and `agent_id`
- [ ] 6.2 After STT: POST transcript to brain via `POST /api/threads/{id}/messages` and await response
- [ ] 6.3 Store transcript as `role=user` message in thread (brain handles this automatically via message API)
- [ ] 6.4 Implement `POST /api/voice/calls/{call_sid}/hangup` endpoint to allow brain-initiated termination

## 7. Governance & Limits

- [ ] 7.1 Implement max call duration timer: schedule hangup at `max_call_duration_seconds` (default 300); play wrap-up TTS before hanging up
- [ ] 7.2 Parse `voice_enabled` and `max_call_duration_seconds` fields from agent entries in `divisions.yaml`
- [ ] 7.3 Insert `voice_calls` row on call connect; update on call end

## 8. Tests

- [ ] 8.1 Unit tests for inbound webhook handler: valid signature → TwiML response; invalid signature → 403; voice-disabled agent → rejection TwiML
- [ ] 8.2 Unit tests for allowlist enforcement: number on list accepted; number not on list rejected
- [ ] 8.3 Unit tests for VAD: silence detection triggers STT call; non-silent audio buffered
- [ ] 8.4 Integration test: end-to-end mock of Twilio media stream → STT → brain → TTS → audio stream out
