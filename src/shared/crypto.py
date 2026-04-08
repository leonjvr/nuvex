"""Fernet-based encryption helpers for skill environment dictionaries.

Key is read from the NUVEX_SECRET_KEY environment variable.
The key must be a URL-safe base64-encoded 32-byte value (Fernet standard).
Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import json
import os

from cryptography.fernet import Fernet


def _get_fernet(key: str | None = None) -> Fernet:
    """Return a Fernet instance using *key* or NUVEX_SECRET_KEY env var."""
    k = key or os.environ.get("NUVEX_SECRET_KEY", "")
    if not k:
        raise ValueError(
            "NUVEX_SECRET_KEY is not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())\""
        )
    return Fernet(k.encode() if isinstance(k, str) else k)


def encrypt_env(data: dict, key: str | None = None) -> bytes:
    """Serialize *data* to JSON and encrypt with Fernet.

    Args:
        data: dict of environment variable name→value pairs.
        key:  Fernet key string. Falls back to NUVEX_SECRET_KEY env var.

    Returns:
        Encrypted bytes token.

    Raises:
        ValueError: if no key is available.
    """
    f = _get_fernet(key)
    return f.encrypt(json.dumps(data).encode())


def decrypt_env(token: bytes, key: str | None = None) -> dict:
    """Decrypt *token* and deserialize to a dict.

    Args:
        token: Fernet-encrypted bytes.
        key:   Fernet key string. Falls back to NUVEX_SECRET_KEY env var.

    Returns:
        Decrypted dict.

    Raises:
        ValueError: if no key is available.
        cryptography.fernet.InvalidToken: if decryption fails.
    """
    f = _get_fernet(key)
    return json.loads(f.decrypt(token).decode())
