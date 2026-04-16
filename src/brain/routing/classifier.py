"""Task classifier — infer task type and capability signals from message content."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_CODE_KEYWORDS = re.compile(
    r"\b(python|javascript|typescript|bash|shell|function|class|import|def |"
    r"bug|fix|error|traceback|stacktrace|code|script|refactor|implement)\b",
    re.IGNORECASE,
)
_VOICE_KEYWORDS = re.compile(r"\[Audio\]|\[Voice\]", re.IGNORECASE)
_MULTI_STEP = re.compile(
    r"\b(first|then|finally|step \d|next|after that|lastly)\b", re.IGNORECASE
)
_TOOL_KEYWORDS = re.compile(
    r"\b(search for|look up|check the internet|read the file|write to|"
    r"call the api|fetch from|send a request|query the db|browse|open url)\b",
    re.IGNORECASE,
)
_HIGH_RISK = re.compile(
    r"\b(delete|drop table|rm -rf|credentials|secret|password|payment|"
    r"transfer funds|production database|money)\b",
    re.IGNORECASE,
)
_MED_RISK = re.compile(
    r"\b(update|modify|change|replace|deploy|migrate|overwrite)\b",
    re.IGNORECASE,
)
_URL_PATTERN = re.compile(r"https?://", re.IGNORECASE)
_FILE_PATH_PATTERN = re.compile(r"[/\\][a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,6}")
_CODE_FENCE_PATTERN = re.compile(r"```")

_DEFAULT_COMPLEX_KEYWORDS = re.compile(
    r"\b(explain|analyze|analyse|compare|implement|debug|refactor|design|architect|review)\b",
    re.IGNORECASE,
)


@dataclass
class ClassificationResult:
    """Structured output of the detailed classifier."""

    task_type: str           # simple_reply | conversation | code_generation | voice_response | trivial_reply
    complexity_score: float  # 0.0–1.0; higher means more complex
    output_type: str         # text | code | structured | voice
    tool_likelihood: float   # 0.0–1.0; probability that tools will be needed
    risk_class: str          # low | medium | high
    budget_pressure: float = field(default=0.0)  # injected by caller, 0.0–1.0


def _complexity(message: str) -> float:
    """Heuristic complexity score in [0.0, 1.0]."""
    length_score = min(len(message) / 2000, 0.4)
    step_score = 0.2 if _MULTI_STEP.search(message) else 0.0
    code_score = 0.25 if _CODE_KEYWORDS.search(message) else 0.0
    backtick_score = 0.15 if "```" in message else 0.0
    return min(length_score + step_score + code_score + backtick_score, 1.0)


def _tool_likelihood(message: str) -> float:
    """Estimate probability that tools are needed (0.0–1.0)."""
    matches = len(_TOOL_KEYWORDS.findall(message))
    return min(matches * 0.35, 1.0)


def _risk_class(message: str) -> str:
    if _HIGH_RISK.search(message):
        return "high"
    if _MED_RISK.search(message):
        return "medium"
    return "low"


def _output_type(task_type: str) -> str:
    if task_type == "code_generation":
        return "code"
    if task_type == "voice_response":
        return "voice"
    return "text"


def _is_trivial_reply(
    message: str,
    max_chars: int = 160,
    max_words: int = 28,
    complex_keywords_pattern: re.Pattern | None = None,
    arousal_score: float = 0.0,
) -> bool:
    """Return True when the message qualifies for trivial fast-model routing.

    Deterministic — no LLM call.  All criteria must pass simultaneously.
    If *arousal_score* > 0.75 the check is bypassed (arousal overrides cheapening).

    Spec: hermes-inspired-runtime §5 (5.8–5.12)
    """
    if arousal_score > 0.75:
        return False
    if len(message) > max_chars:
        return False
    words = message.split()
    if len(words) > max_words:
        return False
    if _CODE_FENCE_PATTERN.search(message):
        return False
    if _URL_PATTERN.search(message):
        return False
    if _FILE_PATH_PATTERN.search(message):
        return False
    pattern = complex_keywords_pattern or _DEFAULT_COMPLEX_KEYWORDS
    if pattern.search(message):
        return False
    return True


def classify(message: str) -> str:
    """
    Returns one of: simple_reply | conversation | code_generation | voice_response | trivial_reply
    These map to routing config keys in divisions.yaml.
    """
    if _VOICE_KEYWORDS.search(message):
        return "voice_response"
    if _CODE_KEYWORDS.search(message):
        return "code_generation"
    if _is_trivial_reply(message):
        return "trivial_reply"
    if len(message) < 50:
        return "simple_reply"
    return "conversation"


def classify_detailed(message: str, budget_pressure: float = 0.0) -> ClassificationResult:
    """Return a full ClassificationResult with capability signals for routing."""
    task_type = classify(message)
    return ClassificationResult(
        task_type=task_type,
        complexity_score=_complexity(message),
        output_type=_output_type(task_type),
        tool_likelihood=_tool_likelihood(message),
        risk_class=_risk_class(message),
        budget_pressure=max(0.0, min(budget_pressure, 1.0)),
    )
