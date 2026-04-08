"""Unit tests — language gradient job (Section 29.5).

Spec:
- _fetch_failed_threads SQL excludes error_class='EnvIssue'
- run_language_gradient returns 0 when no failed outcomes exist
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session_cm(session: AsyncMock) -> AsyncMock:
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


# ---------------------------------------------------------------------------
# TestLanguageGradientFetch
# ---------------------------------------------------------------------------

class TestLanguageGradientFetch:
    """spec: _fetch_failed_threads filters EnvIssue at the SQL layer."""

    async def test_language_gradient_excludes_env_issues(self):
        """SQL sent to DB explicitly excludes error_class='EnvIssue'."""
        from src.brain.jobs.language_gradient import _fetch_failed_threads

        mock_result = MagicMock()
        mock_result.fetchall.return_value = []

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        with patch(
            "src.brain.jobs.language_gradient.get_session",
            return_value=_make_session_cm(mock_session),
        ):
            result = await _fetch_failed_threads()

        # Verify the query was issued and contains the EnvIssue exclusion
        assert mock_session.execute.called
        call_args = mock_session.execute.call_args
        sql_text = str(call_args[0][0])  # First positional arg is the TextClause
        assert "EnvIssue" in sql_text, (
            "Expected SQL to filter out EnvIssue error class, "
            f"but got SQL: {sql_text}"
        )
        assert result == []

    async def test_language_gradient_empty_if_no_failures(self):
        """run_language_gradient returns 0 candidates when no failed outcomes exist."""
        from src.brain.jobs.language_gradient import run_language_gradient

        with patch(
            "src.brain.jobs.language_gradient._fetch_failed_threads",
            return_value=[],
        ):
            count = await run_language_gradient()

        assert count == 0
