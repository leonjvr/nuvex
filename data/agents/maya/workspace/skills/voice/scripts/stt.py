#!/usr/bin/env python3
"""ElevenLabs Speech-to-Text: transcribe an audio file or URL."""
import os
import sys
import tempfile
import urllib.request
from pathlib import Path


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


def transcribe(audio_source: str) -> str:
    import urllib.request
    import json

    api_key = _load_api_key()

    # Download remote URL to a temp file if needed
    if audio_source.startswith("http://") or audio_source.startswith("https://"):
        suffix = Path(audio_source.split("?")[0]).suffix or ".ogg"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            tmp_path = f.name
        req = urllib.request.Request(audio_source)
        with urllib.request.urlopen(req) as resp, open(tmp_path, "wb") as out:
            out.write(resp.read())
        audio_path = tmp_path
    else:
        audio_path = audio_source

    # Use requests if available, else fall back to urllib multipart
    try:
        import requests
        with open(audio_path, "rb") as f:
            resp = requests.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": api_key},
                files={"file": (Path(audio_path).name, f, "audio/mpeg")},
                data={"model_id": "scribe_v1"},
                timeout=60,
            )
        resp.raise_for_status()
        return resp.json().get("text", "")
    except ImportError:
        pass

    # Fallback: urllib multipart
    boundary = "----ElevenLabsBoundary"
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()
    body_parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\nscribe_v1\r\n",
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{Path(audio_path).name}\"\r\nContent-Type: audio/mpeg\r\n\r\n",
    ]
    body = b"".join(p.encode() for p in body_parts) + audio_bytes + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/speech-to-text",
        data=body,
        headers={
            "xi-api-key": api_key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read()).get("text", "")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: stt.py <audio_url_or_path>", file=sys.stderr)
        sys.exit(1)
    print(transcribe(sys.argv[1]))
