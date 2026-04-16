"""Tool result budget & reference handles — prevent context window blowout.

Spec: hermes-inspired-runtime §2
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

_THREADS_ROOT = Path("data") / "threads"
_TRUNCATION_SUFFIX = "\n[Output truncated at {limit:,} chars. Full output saved as reference: {handle}]"


@dataclass
class ToolResultReference:
    handle: str
    thread_id: str
    tool_name: str
    original_chars: int
    truncated_at: int
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def _overflow_dir(thread_id: str) -> Path:
    return _THREADS_ROOT / thread_id / "tool_results"


def save_overflow(thread_id: str, tool_name: str, content: str) -> ToolResultReference:
    """Write *content* to the overflow file store and return a reference handle."""
    handle = str(uuid.uuid4())
    out_dir = _overflow_dir(thread_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{handle}.txt"
    out_path.write_text(content, encoding="utf-8")
    return ToolResultReference(
        handle=handle,
        thread_id=thread_id,
        tool_name=tool_name,
        original_chars=len(content),
        truncated_at=0,
    )


def read_overflow(handle: str, thread_id: str, max_chars: int = 30000, offset: int = 0) -> str:
    """Read overflow content for *handle*.

    Validates that *handle* is a valid UUID to prevent path traversal attacks.
    Returns an error string if the file is missing (graceful degradation).
    """
    try:
        uuid.UUID(handle)
    except ValueError:
        return f"[error] Invalid reference handle: {handle!r}"

    out_path = _overflow_dir(thread_id) / f"{handle}.txt"
    if not out_path.exists():
        return (
            f"[error] Reference file {handle!r} not found. "
            "It may have been cleared after a restart."
        )
    try:
        content = out_path.read_text(encoding="utf-8")
        chunk = content[offset : offset + max_chars]
        remaining = max(0, len(content) - offset - max_chars)
        if remaining:
            chunk += f"\n[{remaining:,} more chars — call read_tool_result with offset={offset + max_chars}]"
        return chunk
    except OSError as exc:
        return f"[error] Could not read reference file: {exc}"


def enforce_tool_budget(
    tool_name: str,
    output: str,
    thread_id: str,
    max_chars: int = 30000,
) -> tuple[str, ToolResultReference | None]:
    """Truncate *output* to *max_chars* and save overflow to disk.

    Returns (final_output, reference | None).
    Reference is None when no truncation occurred.
    """
    if len(output) <= max_chars:
        return output, None

    ref = save_overflow(thread_id, tool_name, output)
    ref.truncated_at = max_chars
    truncated = output[:max_chars] + _TRUNCATION_SUFFIX.format(
        limit=max_chars, handle=ref.handle
    )
    log.debug(
        "result_budget: truncated %s from %d to %d chars, handle=%s",
        tool_name,
        len(output),
        max_chars,
        ref.handle,
    )
    return truncated, ref


def enforce_turn_budget(
    tool_results: list[tuple[str, str]],
    thread_id: str,
    turn_budget_chars: int = 200000,
    max_result_chars: int = 30000,
) -> list[str]:
    """Ensure total tool output in a turn is under *turn_budget_chars*.

    Args:
        tool_results: List of (tool_name, output_str) in execution order.
        thread_id: Thread identifier for building overflow file paths.
        turn_budget_chars: Max aggregate characters across all results.
        max_result_chars: Per-tool cap for each replaced result.

    Returns:
        List of output strings (same order), with oldest results replaced by
        reference handles when the aggregate exceeds the budget.
    """
    outputs = [o for _, o in tool_results]
    total = sum(len(o) for o in outputs)
    if total <= turn_budget_chars:
        return outputs

    # Replace oldest results first until under budget
    for i, (tool_name, original) in enumerate(tool_results):
        if total <= turn_budget_chars:
            break
        current = outputs[i]
        if len(current) <= 50:  # already a stub
            continue
        ref = save_overflow(thread_id, tool_name, original)
        stub = (
            f"[Tool output ({len(original):,} chars) stored as reference: {ref.handle}. "
            "Use read_tool_result to retrieve it.]"
        )
        total -= len(current) - len(stub)
        outputs[i] = stub
        log.debug(
            "result_budget: turn_budget overflow — replaced %s result with stub (handle=%s)",
            tool_name,
            ref.handle,
        )

    return outputs


def cleanup_tool_results(thread_id: str) -> None:
    """Delete all tool result overflow files for *thread_id* on archive."""
    import shutil

    out_dir = _overflow_dir(thread_id)
    if out_dir.exists():
        try:
            shutil.rmtree(out_dir)
            log.debug("result_budget: deleted overflow dir %s", out_dir)
        except OSError as exc:
            log.warning("result_budget: could not delete %s: %s", out_dir, exc)
