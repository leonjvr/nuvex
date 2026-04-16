"""Secret scanner for memory writes — prevents credentials from being persisted.

Called before any INSERT into the ``memories`` table.  Returns ``(True, pattern_name)``
when the supplied text looks like a credential or secret; ``(False, "")`` otherwise.

Patterns are compiled once at import time.  Detection is best-effort: it catches
the most common formats but is not a full-featured DLP solution.
"""
from __future__ import annotations

import re
from typing import Final

# ---------------------------------------------------------------------------
# Pattern registry — (name, compiled_regex)
# ---------------------------------------------------------------------------
_PATTERNS: Final[list[tuple[str, re.Pattern[str]]]] = [
    # Generic high-entropy tokens
    ("generic_api_key",         re.compile(r'\b(api[_-]?key|apikey)\s*[=:]\s*["\']?[A-Za-z0-9_\-]{20,}', re.I)),
    ("generic_secret",          re.compile(r'\b(secret|api[_-]?secret)\s*[=:]\s*["\']?[A-Za-z0-9_\-]{20,}', re.I)),
    ("generic_token",           re.compile(r'\b(token|access[_-]?token|auth[_-]?token)\s*[=:]\s*["\']?[A-Za-z0-9_\.\-]{20,}', re.I)),
    ("bearer_header",           re.compile(r'Authorization\s*:\s*Bearer\s+[A-Za-z0-9\._\-]{20,}', re.I)),

    # AWS
    ("aws_access_key",          re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ("aws_secret_key",          re.compile(r'\b[0-9a-zA-Z/+]{40}\b')),  # broad; paired with context below

    # OpenAI / Anthropic / common AI providers
    ("openai_key",              re.compile(r'\bsk-[A-Za-z0-9]{20,}\b')),
    ("anthropic_key",           re.compile(r'\bsk-ant-[A-Za-z0-9\-_]{30,}\b')),

    # GitHub
    ("github_pat",              re.compile(r'\bghp_[A-Za-z0-9]{36}\b')),
    ("github_oauth",            re.compile(r'\bgho_[A-Za-z0-9]{36}\b')),

    # Private keys / certificates
    ("pem_private_key",         re.compile(r'-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----')),

    # Passwords in connection strings
    ("db_connection_string",    re.compile(r'\b(postgres|mysql|mongodb|redis)://[^/\s]*:[^@\s]+@', re.I)),
    ("password_field",          re.compile(r'\b(password|passwd|pwd)\s*[=:]\s*["\']?[^\s"\']{8,}', re.I)),

    # Phone numbers combined with names (lightweight PII guard)
    # (disabled by default — uncomment to activate)
    # ("phone_with_name",       re.compile(r'[A-Z][a-z]+\s+[A-Z][a-z]+.*\+?1?\d{10,}')),
]


def scan(text: str) -> tuple[bool, str]:
    """Return ``(True, pattern_name)`` if *text* matches a secret pattern.

    Args:
        text: The memory content string to inspect.

    Returns:
        A 2-tuple.  First element is ``True`` when a match is found; second
        element is the name of the matching pattern (empty string when clean).
    """
    for name, pattern in _PATTERNS:
        if pattern.search(text):
            return True, name
    return False, ""
