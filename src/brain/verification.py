"""Green Contract — task verification levels.

Defines VerificationLevel enum and the VerificationEngine that auto-advances
a task's verification level based on acceptance criteria checks.

Verification levels (ascending):
  SelfReported       — agent says it's done
  OutputValidated    — output file / string presence confirmed
  ConstraintsMet     — all structured acceptance criteria evaluated
  PeerReviewed       — sent to human operator for approval
  IntegrationVerified — external integration confirmed (e.g. CI green)
"""
from __future__ import annotations

import logging
import re
from enum import IntEnum
from pathlib import Path

log = logging.getLogger(__name__)


class VerificationLevel(IntEnum):
    SelfReported = 0
    OutputValidated = 1
    ConstraintsMet = 2
    PeerReviewed = 3
    IntegrationVerified = 4


# Minimum verification level per agent tier
TIER_MIN_VERIFICATION: dict[str, VerificationLevel] = {
    "T1": VerificationLevel.SelfReported,
    "T2": VerificationLevel.OutputValidated,
    "T3": VerificationLevel.PeerReviewed,
    "T4": VerificationLevel.PeerReviewed,
}


# ---------------------------------------------------------------------------
# Acceptance criteria checkers
# ---------------------------------------------------------------------------

def _check_file_exists(criterion: str) -> bool:
    """Criterion: 'file_exists:<path>'"""
    _, _, path = criterion.partition(":")
    return Path(path.strip()).exists()


def _check_file_contains(criterion: str) -> bool:
    """Criterion: 'file_contains:<path>:<substring>'"""
    parts = criterion.split(":", 2)
    if len(parts) < 3:
        return False
    _, path, needle = parts
    try:
        return needle.strip() in Path(path.strip()).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False


def _check_string_present(criterion: str, output: str) -> bool:
    """Criterion: 'output_contains:<substring>' — checked against agent output."""
    _, _, needle = criterion.partition(":")
    return needle.strip() in output


def _check_regex(criterion: str, output: str) -> bool:
    """Criterion: 'output_matches:<regex>'"""
    _, _, pattern = criterion.partition(":")
    return bool(re.search(pattern.strip(), output))


def evaluate_criterion(criterion: str, agent_output: str = "") -> bool:
    """Evaluate a single acceptance criterion string. Returns True if met."""
    criterion = criterion.strip()
    if criterion.startswith("file_exists:"):
        return _check_file_exists(criterion)
    if criterion.startswith("file_contains:"):
        return _check_file_contains(criterion)
    if criterion.startswith("output_contains:"):
        return _check_string_present(criterion, agent_output)
    if criterion.startswith("output_matches:"):
        return _check_regex(criterion, agent_output)
    # Unknown criterion type — treat as unverifiable (conservative)
    log.debug("Unknown acceptance criterion type: %s", criterion)
    return False


# ---------------------------------------------------------------------------
# Verification engine
# ---------------------------------------------------------------------------

class VerificationResult:
    def __init__(
        self,
        level: VerificationLevel,
        passed: list[str],
        failed: list[str],
        meets_tier_minimum: bool,
        needs_peer_review: bool = False,
    ) -> None:
        self.level = level
        self.passed = passed
        self.failed = failed
        self.meets_tier_minimum = meets_tier_minimum
        self.needs_peer_review = needs_peer_review

    def summary(self) -> str:
        lines = [f"Verification: {self.level.name}"]
        if self.passed:
            lines.append(f"  Passed ({len(self.passed)}): {', '.join(self.passed[:5])}")
        if self.failed:
            lines.append(f"  Failed ({len(self.failed)}): {', '.join(self.failed[:5])}")
        if not self.meets_tier_minimum:
            lines.append("  WARNING: Does not meet tier minimum verification level")
        if self.needs_peer_review:
            lines.append("  ACTION REQUIRED: Peer review pending")
        return "\n".join(lines)


class VerificationEngine:
    def verify(
        self,
        acceptance_criteria: list[str],
        agent_output: str,
        tier: str = "T2",
    ) -> VerificationResult:
        passed: list[str] = []
        failed: list[str] = []

        for criterion in acceptance_criteria:
            if evaluate_criterion(criterion, agent_output):
                passed.append(criterion)
            else:
                failed.append(criterion)

        # Determine reached level
        level = VerificationLevel.SelfReported
        if acceptance_criteria:
            if len(failed) == 0:
                level = VerificationLevel.ConstraintsMet
            elif len(passed) > 0:
                level = VerificationLevel.OutputValidated

        min_level = TIER_MIN_VERIFICATION.get(tier, VerificationLevel.OutputValidated)
        meets_minimum = level >= min_level
        needs_peer_review = tier in ("T3", "T4") and level < VerificationLevel.PeerReviewed

        return VerificationResult(
            level=level,
            passed=passed,
            failed=failed,
            meets_tier_minimum=meets_minimum,
            needs_peer_review=needs_peer_review,
        )


_engine = VerificationEngine()


def verify_task(
    acceptance_criteria: list[str],
    agent_output: str,
    tier: str = "T2",
) -> VerificationResult:
    """Convenience function — verify task completion."""
    return _engine.verify(acceptance_criteria, agent_output, tier)
