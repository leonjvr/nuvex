"""Unit tests — verification: criterion evaluation and tier minimums."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from src.brain.verification import (
    VerificationLevel,
    VerificationEngine,
    TIER_MIN_VERIFICATION,
    evaluate_criterion,
    _check_file_exists,
    _check_file_contains,
    _check_string_present,
    _check_regex,
)


# ---------------------------------------------------------------------------
# VerificationLevel enum ordering
# ---------------------------------------------------------------------------

class TestVerificationLevelOrdering:
    def test_self_reported_is_lowest(self):
        assert VerificationLevel.SelfReported < VerificationLevel.OutputValidated

    def test_constraints_met_is_above_output_validated(self):
        assert VerificationLevel.ConstraintsMet > VerificationLevel.OutputValidated

    def test_peer_reviewed_is_above_constraints_met(self):
        assert VerificationLevel.PeerReviewed > VerificationLevel.ConstraintsMet

    def test_integration_verified_is_highest(self):
        assert VerificationLevel.IntegrationVerified > VerificationLevel.PeerReviewed


# ---------------------------------------------------------------------------
# Tier minimums
# ---------------------------------------------------------------------------

class TestTierMinimums:
    def test_t1_minimum_is_self_reported(self):
        assert TIER_MIN_VERIFICATION["T1"] == VerificationLevel.SelfReported

    def test_t2_minimum_is_output_validated(self):
        assert TIER_MIN_VERIFICATION["T2"] == VerificationLevel.OutputValidated

    def test_t3_minimum_is_peer_reviewed(self):
        assert TIER_MIN_VERIFICATION["T3"] == VerificationLevel.PeerReviewed

    def test_t4_minimum_is_peer_reviewed(self):
        assert TIER_MIN_VERIFICATION["T4"] == VerificationLevel.PeerReviewed


# ---------------------------------------------------------------------------
# Individual criterion evaluators
# ---------------------------------------------------------------------------

class TestFileExistsCriterion:
    def test_existing_file(self):
        with tempfile.NamedTemporaryFile() as f:
            assert _check_file_exists(f"file_exists:{f.name}") is True

    def test_nonexistent_file(self):
        assert _check_file_exists("file_exists:/tmp/does_not_exist_xyz.txt") is False


class TestFileContainsCriterion:
    def test_present_substring(self, monkeypatch):
        # Use monkeypatch to avoid Windows drive-letter colon breaking criterion parsing
        monkeypatch.setattr(Path, "read_text", lambda self, **kw: "hello world")
        assert _check_file_contains("file_contains:/tmp/test.txt:hello") is True

    def test_absent_substring(self, monkeypatch):
        monkeypatch.setattr(Path, "read_text", lambda self, **kw: "hello world")
        assert _check_file_contains("file_contains:/tmp/test.txt:goodbye") is False

    def test_missing_file_returns_false(self):
        assert _check_file_contains("file_contains:/nonexistent_xyzzy.txt:text") is False


class TestOutputContainsCriterion:
    def test_substring_present(self):
        assert _check_string_present("output_contains:success", "task completed with success") is True

    def test_substring_absent(self):
        assert _check_string_present("output_contains:error", "all done") is False

    def test_empty_output(self):
        assert _check_string_present("output_contains:hello", "") is False


class TestOutputMatchesCriterion:
    def test_matching_regex(self):
        assert _check_regex(r"output_matches:\d{3}-\d{4}", "call 555-1234 now") is True

    def test_non_matching_regex(self):
        assert _check_regex(r"output_matches:^error", "success") is False


class TestEvaluateCriterion:
    def test_unknown_criterion_returns_false(self):
        assert evaluate_criterion("unknown_type:something") is False

    def test_output_contains_dispatches(self):
        assert evaluate_criterion("output_contains:done", "task is done") is True

    def test_output_matches_dispatches(self):
        assert evaluate_criterion(r"output_matches:\bsuccess\b", "overall success") is True


# ---------------------------------------------------------------------------
# VerificationEngine
# ---------------------------------------------------------------------------

class TestVerificationEngine:
    def test_all_criteria_met_gives_constraints_met(self):
        engine = VerificationEngine()
        result = engine.verify(
            acceptance_criteria=["output_contains:ok", "output_contains:done"],
            agent_output="ok and done",
            tier="T1",
        )
        assert result.level == VerificationLevel.ConstraintsMet
        assert len(result.passed) == 2
        assert len(result.failed) == 0

    def test_no_criteria_gives_self_reported(self):
        engine = VerificationEngine()
        result = engine.verify(acceptance_criteria=[], agent_output="anything", tier="T1")
        assert result.level == VerificationLevel.SelfReported

    def test_some_criteria_failed_gives_output_validated(self):
        engine = VerificationEngine()
        result = engine.verify(
            acceptance_criteria=["output_contains:good", "output_contains:missing"],
            agent_output="good stuff",
            tier="T2",
        )
        assert result.level == VerificationLevel.OutputValidated
        assert "output_contains:good" in result.passed
        assert "output_contains:missing" in result.failed

    def test_meets_tier_minimum_for_t1(self):
        engine = VerificationEngine()
        result = engine.verify([], "output", tier="T1")
        assert result.meets_tier_minimum is True

    def test_does_not_meet_t3_minimum_with_output_validated(self):
        engine = VerificationEngine()
        result = engine.verify(
            acceptance_criteria=["output_contains:ok", "output_contains:missing"],
            agent_output="ok",
            tier="T3",
        )
        assert result.meets_tier_minimum is False
        assert result.needs_peer_review is True

    def test_summary_contains_level_name(self):
        engine = VerificationEngine()
        result = engine.verify(["output_contains:yes"], "yes it worked", tier="T2")
        summary = result.summary()
        assert "ConstraintsMet" in summary
