"""Weekly language gradient job — generates policy candidates from failed threads (Section 29.5)."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import text

from ..db import get_session
from ..models.outcomes import PolicyCandidate

log = logging.getLogger(__name__)

MAX_THREADS_PER_BATCH = 10
MAX_MESSAGES_PER_THREAD = 3  # first+last messages only


async def run_language_gradient() -> int:
    """Run the weekly language gradient reflection job.

    Returns the number of policy candidates created.
    """
    log.info("language_gradient: starting weekly run")
    failed_threads = await _fetch_failed_threads()

    if not failed_threads:
        log.info("language_gradient: no eligible failed threads this week")
        return 0

    log.info("language_gradient: processing %d failed threads", len(failed_threads))

    candidates_created = 0
    # Process in batches to stay within LLM context limits
    for i in range(0, len(failed_threads), MAX_THREADS_PER_BATCH):
        batch = failed_threads[i: i + MAX_THREADS_PER_BATCH]
        try:
            new_candidates = await _process_batch(batch)
            candidates_created += new_candidates
        except Exception as exc:
            log.error("language_gradient: batch %d failed: %s", i // MAX_THREADS_PER_BATCH, exc)

    log.info("language_gradient: created %d policy candidates", candidates_created)
    return candidates_created


async def _fetch_failed_threads() -> list[dict[str, Any]]:
    """Load failed outcomes from the past 7 days (excluding EnvIssue)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    try:
        async with get_session() as session:
            result = await session.execute(
                text(
                    "SELECT id, thread_id, agent_id, error_class, tools_used, "
                    "       denial_count, iteration_count "
                    "FROM outcomes "
                    "WHERE succeeded = false "
                    "  AND (error_class IS NULL OR error_class != 'EnvIssue') "
                    "  AND created_at >= :cutoff "
                    "ORDER BY created_at DESC "
                    "LIMIT 100"
                ),
                {"cutoff": cutoff},
            )
            return [dict(r) for r in result.mappings().all()]
    except Exception as exc:
        log.error("language_gradient: failed to fetch failed threads: %s", exc)
        return []


async def _load_thread_messages(thread_id: str) -> list[str]:
    """Load abbreviated message history for a thread."""
    try:
        async with get_session() as session:
            result = await session.execute(
                text(
                    "SELECT role, content FROM messages "
                    "WHERE thread_id = :tid "
                    "ORDER BY id ASC "
                    "LIMIT :limit"
                ),
                {"tid": thread_id, "limit": MAX_MESSAGES_PER_THREAD * 2},
            )
            return [f"{r[0]}: {str(r[1])[:300]}" for r in result.fetchall()]
    except Exception:
        return []


async def _process_batch(batch: list[dict[str, Any]]) -> int:
    """Call LLM to reflect on a batch of failures and create policy candidates."""
    # Build trajectory summaries
    trajectories = []
    for outcome in batch:
        messages = await _load_thread_messages(outcome["thread_id"])
        trajectories.append({
            "thread_id": outcome["thread_id"],
            "agent_id": outcome["agent_id"],
            "error_class": outcome.get("error_class"),
            "denial_count": outcome.get("denial_count", 0),
            "tools_used": outcome.get("tools_used", []),
            "messages": messages[:6],  # first 3 exchanges
        })

    prompt = _build_reflection_prompt(trajectories)

    try:
        response_text = await _call_reflection_llm(prompt)
        candidates_data = _parse_candidates(response_text)
    except Exception as exc:
        log.error("language_gradient: LLM reflection failed: %s", exc)
        return 0

    created = 0
    for candidate_data in candidates_data:
        try:
            await _save_candidate(candidate_data)
            created += 1
        except Exception as exc:
            log.warning("language_gradient: failed to save candidate: %s", exc)

    # Notify event bus if any candidates created
    if created > 0:
        try:
            from ..events import publish
            await publish(
                "policy.candidate_ready",
                {"count": created, "source": "language_gradient"},
            )
        except Exception as exc:
            log.warning("language_gradient: event publish failed: %s", exc)

    return created


def _build_reflection_prompt(trajectories: list[dict]) -> str:
    traj_text = json.dumps(trajectories, indent=2, default=str)
    return f"""You are a policy engineer reviewing failed agent interactions.

For each failure trajectory below, identify ONE specific policy rule that would have
prevented or mitigated the failure. Only propose rules with high confidence.
Skip trajectories where the failure was clearly environmental (import error, missing dep, network).

Output a JSON array of PolicyCandidate objects with this exact schema:
{{
  "agent_id": string | null,
  "condition_tree": {{
    "type": "AND" | "OR",
    "conditions": [
      {{"field": string, "op": "eq" | "contains" | "gt" | "lt", "value": any}}
    ]
  }},
  "action": "deny" | "escalate" | "warn" | "throttle",
  "rationale": "one sentence explaining the rule",
  "source_thread_ids": [string]
}}

If no clear policy rule can be derived, output an empty array [].

Trajectories:
{traj_text}

Output only valid JSON. No markdown, no explanation."""


async def _call_reflection_llm(prompt: str) -> str:
    """Call the configured fast model for reflection."""
    import os
    try:
        from ...brain.nodes.call_llm import get_auxiliary_model_name
        fast_model = get_auxiliary_model_name("")
    except Exception:
        fast_model = "gpt-4o-mini"

    try:
        import openai
        client = openai.AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        resp = await client.chat.completions.create(
            model=fast_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2000,
        )
        return resp.choices[0].message.content or "[]"
    except Exception:
        pass

    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
        resp = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        block = resp.content[0]
        return block.text if hasattr(block, "text") else ""
    except Exception as exc:
        raise RuntimeError(f"No LLM available for language gradient job: {exc}") from exc


def _parse_candidates(response_text: str) -> list[dict]:
    """Parse JSON response from LLM into candidate dicts."""
    try:
        # Strip markdown code fences if present
        text = response_text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1])
        data = json.loads(text)
        if isinstance(data, list):
            return data
        return []
    except Exception as exc:
        log.warning("language_gradient: JSON parse failed: %s — raw: %.200s", exc, response_text)
        return []


async def _save_candidate(data: dict) -> None:
    """Persist one policy candidate row."""
    candidate = PolicyCandidate(
        agent_id=data.get("agent_id"),
        condition_tree=data.get("condition_tree", {}),
        action=data.get("action", "warn"),
        rationale=data.get("rationale", ""),
        source_threads=data.get("source_thread_ids", []),
        status="pending_review",
    )
    async with get_session() as session:
        session.add(candidate)
        await session.commit()
