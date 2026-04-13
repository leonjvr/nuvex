## Context

NUVEX today has three gateway containers (WhatsApp, Telegram, Email). Each gateway is a standalone FastAPI service that receives channel-specific events, maps them to the brain's REST API (`POST /api/threads/{id}/messages`), and delivers brain responses back to the channel. Voice follows the same pattern but has additional real-time constraints: audio streams must be processed with low latency, and turn-taking must be handled (detecting when the caller has stopped speaking).

Twilio Media Streams deliver audio over a WebSocket in real time as µ-law encoded 8 kHz PCM chunks. The gateway accumulates chunks, runs VAD (Voice Activity Detection) to detect end of utterance, sends the audio to Whisper for transcription, posts the transcript to brain, receives the text response, synthesises speech, and streams it back to Twilio.

## Goals / Non-Goals

**Goals:**
- Handle inbound Twilio PSTN calls with real-time STT → brain → TTS pipeline
- Support per-agent voice opt-in and caller allowlists for governance
- Track call duration and cost for budget enforcement
- Expose a `POST /api/voice/calls/{call_sid}/hangup` endpoint for agent-initiated call termination

**Non-Goals:**
- WebRTC/browser-based calling (deferred to v2)
- Outbound dialling (agent initiates call to a user) — deferred to v2
- Self-hosted Whisper container (documented as a configuration option, not built)
- Multi-party/conference calls

## Decisions

### D1 — Twilio Media Streams over raw SIP or WebRTC

**Decision:** Use Twilio Programmable Voice + Media Streams (WebSocket) for the initial integration.

**Rationale:** Twilio handles PSTN termination, codec normalisation, and call state management. This removes enormous infrastructure complexity from the gateway. Operators get a working phone number in minutes. Twilio's Python SDK is mature and well-documented.

**Alternative considered:** Self-hosted Asterisk + SIP. Rejected — requires operator infrastructure expertise and a SIP trunk, far too much friction for adoption.

### D2 — VAD via energy threshold with 1-second silence detection

**Decision:** End-of-utterance is detected by a 1-second silence window (RMS energy below threshold). Audio chunks since the last end-of-utterance are buffered and sent to Whisper when silence is detected.

**Rationale:** Simple, low-latency, no additional model needed. Sufficient for phone call quality audio (8 kHz µ-law). Can be tuned via env var `VOICE_SILENCE_THRESHOLD_MS` (default 1000).

**Alternative considered:** Silero VAD model. Better for noisy environments but adds ~40 MB to the image and import latency. Deferred to v2 as an option.

### D3 — STT and TTS via OpenAI API; local fallback documented but not built

**Decision:** Primary STT is OpenAI Whisper API (`whisper-1`). Primary TTS is OpenAI TTS API (`tts-1`, voice `alloy`). Both configurable via env var. A comment in the code documents the interface to swap in a local Whisper compatible server.

**Rationale:** Fastest path to working voice. OpenAI's APIs are reliable and the quality is sufficient. Operators who need self-hosted can use the `OPENAI_BASE_URL` env var to point to a compatible local server (e.g. Faster-Whisper-Server).

### D4 — Voice call metadata stored in `voice_calls` table

**Decision:** Each call creates a row in `voice_calls` (`call_sid`, `agent_id`, `thread_id`, `caller_number`, `started_at`, `ended_at`, `duration_seconds`, `turn_count`). This powers budget enforcement (max call duration, max turns per call).

**Rationale:** Consistent with how NUVEX tracks all other agent activity in Postgres. Enables future reporting and per-agent voice budget caps.

## Risks / Trade-offs

- **Latency**: STT + brain LLM + TTS adds 2–6 seconds of delay. Mitigation: stream TTS back to Twilio as it generates (chunked HTTP) rather than waiting for full response.
- **Whisper cost**: Long calls (15 min) can cost ~$0.18 in Whisper API fees. Mitigation: enforce `max_call_duration_seconds` governance limit (default 300 seconds / 5 min).
- **Twilio webhook security**: Twilio signs all webhooks. The gateway MUST validate the `X-Twilio-Signature` header on every inbound webhook request.

## Migration Plan

1. Create `src/gateway/voice/` directory and Dockerfile
2. Run Alembic migration to add `voice_calls` table
3. Add `gateway-voice` to `docker-compose.local.yml` on port `9104`
4. Configure Twilio webhook URL to point to `gateway-voice` public endpoint
5. No changes to existing services; brain sees voice messages as standard thread messages

## Open Questions

- Should call transcripts be saved to the thread message history for later retrieval? → **Proposed: yes**, transcript stored as a role=user message in the brain's thread, so the agent has context.
- Should TTS voice be configurable per agent? → **Proposed: yes**, `tts_voice: alloy` in `divisions.yaml` defaulting to `alloy`.
