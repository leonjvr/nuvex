#!/usr/bin/env python3
"""ElevenLabs Text-to-Speech: synthesise speech and save as MP3."""
import os
import sys
import json
from pathlib import Path

DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9"  # Charlotte — warm and clear
DEFAULT_OUT = "/tmp/tts_reply.mp3"


def _load_api_key() -> str:
    env_file = Path("~/.config/elevenlabs/.env").expanduser()
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            if line.startswith("ELEVENLABS_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key:
        print("ERROR: ELEVENLABS_API_KEY not set. Configure it via the Skills page.", file=sys.stderr)
        sys.exit(1)
    return key


def synthesise(text: str, voice_id: str = DEFAULT_VOICE_ID, out_path: str = DEFAULT_OUT) -> str:
    api_key = _load_api_key()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    payload = json.dumps({
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }).encode()

    try:
        import requests
        resp = requests.post(
            url,
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            data=payload,
            timeout=60,
        )
        resp.raise_for_status()
        audio = resp.content
    except ImportError:
        import urllib.request
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            audio = r.read()

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_bytes(audio)
    return out_path


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="ElevenLabs TTS")
    p.add_argument("text", help="Text to synthesise")
    p.add_argument("--voice", default=DEFAULT_VOICE_ID, help="ElevenLabs voice ID")
    p.add_argument("--out", default=DEFAULT_OUT, help="Output MP3 path")
    args = p.parse_args()
    result = synthesise(args.text, args.voice, args.out)
    print(result)
