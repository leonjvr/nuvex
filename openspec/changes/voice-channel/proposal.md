## Why

Voice is the #7 most-commented feature request on comparable platforms with active community discussion. Real-time voice unlocks two high-value use cases: customer service IVR systems (a primary deployment target for NUVEX) and accessibility for users who cannot type efficiently. Competing platforms have live voice integrations; without one, NUVEX loses bids on any voice-first deployment. Voice is also a natural extension of the existing channel architecture — it is a new gateway, not a change to brain logic.

## What Changes

- Add a new `gateway-voice/` Python service that bridges real-time audio to the NUVEX brain
- Voice gateway handles: inbound audio stream → STT transcription → brain message → TTS synthesis → outbound audio
- Initial transport: **Twilio Programmable Voice** (PSTN phone calls) via TwiML + Media Streams (WebSocket)
- STT: OpenAI Whisper API (with a Whisper-local fallback for self-hosted operators)
- TTS: OpenAI TTS API (with a system-TTS fallback)
- New Docker container `gateway-voice` maps to port `9104` in local dev, uses Netbird in production
- Agents communicate with the voice gateway identically to how they communicate with Telegram/WhatsApp — via the brain's standard message API
- All voice call events (call start, transcription, response, call end) are governance-gated

## Capabilities

### New Capabilities

- `voice-gateway`: Twilio-backed inbound/outbound call handler with WebSocket media stream processing
- `stt-pipeline`: Speech-to-text pipeline (Whisper API primary, Whisper local fallback)
- `tts-pipeline`: Text-to-speech synthesis pipeline (OpenAI TTS primary, system fallback)
- `voice-governance`: Voice-call-specific governance rules (call duration limits, per-agent voice opt-in, caller allowlist)

### Modified Capabilities

- (none — voice is a new gateway; brain governance pipeline has no voice-specific changes required)

## Impact

- **New service**: `src/gateway/voice/` Python FastAPI service
- **New Dockerfile**: `Dockerfile.gateway-voice`
- **New port**: `9104` (local dev), Netbird IP (production)
- **New env vars**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `OPENAI_WHISPER_API_KEY`, `OPENAI_TTS_API_KEY`, `VOICE_ALLOWLIST` (comma-separated E.164 numbers; empty = allow all)
- **`docker-compose.local.yml`**: add `gateway-voice` service
- **`divisions.yaml`**: new optional `voice_enabled: bool` and `voice_allowlist: ["+1..."]` per agent
- **DB**: new `voice_calls` table to track call metadata and governance budget
