"""Task classifier — infer task type from message content before LLM call."""
from __future__ import annotations

import re

_CODE_KEYWORDS = re.compile(
    r"\b(python|javascript|typescript|bash|shell|function|class|import|def |"
    r"bug|fix|error|traceback|stacktrace|code|script|refactor|implement)\b",
    re.IGNORECASE,
)
_VOICE_KEYWORDS = re.compile(r"\[Audio\]|\[Voice\]", re.IGNORECASE)
_LONG_THRESHOLD = 200  # chars


def classify(message: str) -> str:
    """
    Returns one of: simple_reply | conversation | code_generation | voice_response
    These map to routing config keys in divisions.yaml.
    """
    if _VOICE_KEYWORDS.search(message):
        return "voice_response"
    if len(message) < 50 and not _CODE_KEYWORDS.search(message):
        return "simple_reply"
    if _CODE_KEYWORDS.search(message):
        return "code_generation"
    return "conversation"
