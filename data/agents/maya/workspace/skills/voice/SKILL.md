# Voice Skill — Speech-to-Text and Text-to-Speech

## Purpose

Transcribe incoming voice messages using ElevenLabs STT and send voice note replies
using ElevenLabs TTS routed back through the originating channel (WhatsApp, Telegram, etc.).

## When to Use

- A user sends a voice note and you want to transcribe it to text before replying
- You want to respond with a spoken voice note instead of text
- The user says "reply with voice", "send me a voice note", or similar

---

## Scripts Location

All scripts are at: `/data/agents/maya/workspace/skills/elevenlabs/scripts/`

| Script | Usage |
|---|---|
| `stt.py <audio_url_or_path>` | Transcribe audio → stdout transcript |
| `tts.py "<text>" [--voice <id>] [--out <path>]` | Synthesise speech → saves MP3 file |

---

## Voice-to-Text (STT)

```bash
python /data/agents/maya/workspace/skills/elevenlabs/scripts/stt.py "<audio_url>"
```

- Downloads the audio file (URL or local path accepted)
- Sends to ElevenLabs Speech-to-Text (`/v1/speech-to-text`)
- Returns the plain-text transcript on stdout

**After transcription**, treat the transcript as the user's message and respond normally.

---

## Text-to-Voice (TTS)

```bash
python /data/agents/maya/workspace/skills/elevenlabs/scripts/tts.py "Hello, how are you?" --out /tmp/reply.mp3
```

- Synthesises speech using ElevenLabs TTS (`/v1/text-to-speech/{voice_id}`)
- Saves the audio as an MP3 to `--out` (default: `/tmp/tts_reply.mp3`)
- Returns the file path on stdout

**To send the voice note**, use the `send_file` or `send_message` tool from the
channel toolkit with the returned file path.

**Default voice**: `cgSgspJ2msm6clMCkdW9` (Charlotte — warm, clear). Override with `--voice <voice_id>`.

---

## Full Voice Reply Workflow

1. Receive voice message → get audio URL from message metadata
2. Transcribe: `stt.py <audio_url>` → get transcript
3. Process transcript as normal text message
4. Generate reply text
5. Synthesise: `tts.py "<reply>" --out /tmp/reply.mp3`
6. Send audio file back to user via channel send_file tool

---

## Config Required

| Variable | Where |
|---|---|
| `ELEVENLABS_API_KEY` | `~/.config/elevenlabs/.env` |

If the key is missing the script will print an error and exit 1.
Set the key using the Skills page in the dashboard (Credentials section).
