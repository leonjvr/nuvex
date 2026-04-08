"""Unit tests — cron: HEARTBEAT.md parser and schedule registration."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.brain.cron import parse_heartbeat_md, _run_cron_task, _active_jobs


# ---------------------------------------------------------------------------
# parse_heartbeat_md
# ---------------------------------------------------------------------------

FULL_HEARTBEAT = """
# Nuvex Heartbeat Schedule

## daily-digest
- schedule: 0 8 * * *
- agent: maya
- task: Send daily summary to Leon

## hourly-health-check
- schedule: 0 * * * *
- agent: maya
- task: Check gateway health
- extra_key: extra_val

## no-schedule-section
- agent: maya
- task: This should be skipped

## no-agent-section
- schedule: 0 9 * * *
- task: This should also be skipped
"""


class TestParseHeartbeatMd:
    def test_parses_two_valid_jobs(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        assert len(jobs) == 2

    def test_first_job_name(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        assert jobs[0]["name"] == "daily-digest"

    def test_first_job_schedule(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        assert jobs[0]["schedule"] == "0 8 * * *"

    def test_first_job_agent(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        assert jobs[0]["agent"] == "maya"

    def test_task_goes_into_payload(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        assert jobs[0]["payload"]["task"] == "Send daily summary to Leon"

    def test_extra_keys_go_into_payload(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        assert jobs[1]["payload"].get("extra_key") == "extra_val"

    def test_section_without_schedule_is_skipped(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        names = [j["name"] for j in jobs]
        assert "no-schedule-section" not in names

    def test_section_without_agent_is_skipped(self):
        jobs = parse_heartbeat_md(FULL_HEARTBEAT)
        names = [j["name"] for j in jobs]
        assert "no-agent-section" not in names

    def test_empty_content_returns_empty_list(self):
        assert parse_heartbeat_md("") == []

    def test_no_heading_returns_empty_list(self):
        assert parse_heartbeat_md("- schedule: 0 * * * *\n- agent: maya") == []

    def test_single_valid_job(self):
        content = "## backup\n- schedule: 0 2 * * *\n- agent: worker\n"
        jobs = parse_heartbeat_md(content)
        assert len(jobs) == 1
        assert jobs[0]["name"] == "backup"

    def test_whitespace_trimmed_from_values(self):
        content = "## trim-test\n- schedule:  30 6 * * *  \n- agent:  nuvex  \n"
        jobs = parse_heartbeat_md(content)
        assert jobs[0]["schedule"] == "30 6 * * *"
        assert jobs[0]["agent"] == "nuvex"

    def test_multiple_jobs_independent(self):
        content = (
            "## job-a\n- schedule: 0 1 * * *\n- agent: a\n\n"
            "## job-b\n- schedule: 0 2 * * *\n- agent: b\n"
        )
        jobs = parse_heartbeat_md(content)
        assert len(jobs) == 2
        assert jobs[0]["agent"] == "a"
        assert jobs[1]["agent"] == "b"


# ---------------------------------------------------------------------------
# 22.9 — Integration: cron fires, publishes event, records execution
# ---------------------------------------------------------------------------

class TestCronFiresAndRecordsExecution:
    """22.9: cron fires on schedule, invokes agent via event bus, records execution."""

    def _mock_db_session(self, cron_entry=None):
        session = AsyncMock()
        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = cron_entry
        session.execute = AsyncMock(return_value=exec_result)
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        return session

    @pytest.mark.asyncio
    async def test_run_cron_task_publishes_event(self):
        """_run_cron_task must publish a cron.execution event to the event bus."""
        cron_entry = MagicMock()
        session = self._mock_db_session(cron_entry)

        published: list[dict] = []

        async def mock_publish(lane, payload, *, agent_id=None, **kw):
            published.append({"lane": lane, "payload": payload, "agent_id": agent_id})

        with (
            patch("src.brain.cron.get_session", return_value=session),
            patch("src.brain.events.publish", side_effect=mock_publish),
        ):
            await _run_cron_task("daily-report", "maya", {"task": "run report"})

        assert len(published) == 1
        assert published[0]["lane"] == "cron.execution"
        assert published[0]["agent_id"] == "maya"

    @pytest.mark.asyncio
    async def test_run_cron_task_records_last_run(self):
        """_run_cron_task must update the CronEntry.last_run_at in the database."""
        cron_entry = MagicMock()
        cron_entry.last_run_at = None
        session = self._mock_db_session(cron_entry)

        with (
            patch("src.brain.cron.get_session", return_value=session),
            patch("src.brain.events.publish", new_callable=AsyncMock),
        ):
            await _run_cron_task("daily-report", "maya", {"task": "run report"})

        # Verify last_run_at was set and DB was committed
        assert cron_entry.last_run_at is not None
        session.commit.assert_awaited()

    @pytest.mark.asyncio
    async def test_run_cron_task_payload_in_event(self):
        """Cron event payload must include the task payload and cron_name."""
        cron_entry = MagicMock()
        session = self._mock_db_session(cron_entry)

        captured: list[dict] = []

        async def mock_publish(lane, payload, *, agent_id=None, **kw):
            captured.append(payload)

        with (
            patch("src.brain.cron.get_session", return_value=session),
            patch("src.brain.events.publish", side_effect=mock_publish),
        ):
            await _run_cron_task("morning-brief", "maya", {"task": "good morning"})

        assert captured[0].get("cron_name") == "morning-brief"
        assert captured[0].get("task") == "good morning"

    @pytest.mark.asyncio
    async def test_concurrency_guard_skips_active_job(self):
        """If a cron job is already running, subsequent call must be skipped."""
        _active_jobs.add("long-job")

        published: list = []

        async def mock_publish(*a, **kw):
            published.append(True)

        try:
            with patch("src.brain.events.publish", side_effect=mock_publish):
                await _run_cron_task("long-job", "maya", {})
        finally:
            _active_jobs.discard("long-job")

        # Event must NOT have been published — job was skipped
        assert len(published) == 0

    @pytest.mark.asyncio
    async def test_active_jobs_cleaned_up_after_run(self):
        """After _run_cron_task completes, the job must be removed from _active_jobs."""
        cron_entry = MagicMock()
        session = self._mock_db_session(cron_entry)

        with (
            patch("src.brain.cron.get_session", return_value=session),
            patch("src.brain.events.publish", new_callable=AsyncMock),
        ):
            await _run_cron_task("cleanup-test", "maya", {})

        assert "cleanup-test" not in _active_jobs
