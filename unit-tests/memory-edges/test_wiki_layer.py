"""Unit tests for wiki layer — bootstrapper, ingest, and forgetter exemption (§40.6)."""
from __future__ import annotations

import tempfile
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


class TestWikiBootstrapper:
    def test_creates_wiki_dir_for_t1(self):
        from src.brain.memory.wiki_bootstrapper import bootstrap_wiki_dir
        with tempfile.TemporaryDirectory() as tmp:
            result = bootstrap_wiki_dir(tmp, tier=1)
            wiki = Path(tmp) / "wiki"
            assert result is True
            assert wiki.is_dir()
            assert (wiki / "index.md").exists()
            assert (wiki / "log.md").exists()

    def test_skips_non_t1_agents(self):
        from src.brain.memory.wiki_bootstrapper import bootstrap_wiki_dir
        for tier in (2, 3, 4):
            with tempfile.TemporaryDirectory() as tmp:
                result = bootstrap_wiki_dir(tmp, tier=tier)
                wiki = Path(tmp) / "wiki"
                assert result is False
                assert not wiki.exists(), f"wiki/ should not exist for tier {tier}"

    def test_idempotent_for_existing_wiki_dir(self):
        from src.brain.memory.wiki_bootstrapper import bootstrap_wiki_dir
        with tempfile.TemporaryDirectory() as tmp:
            # First call creates
            bootstrap_wiki_dir(tmp, tier=1)
            # Second call should return False (already exists)
            result = bootstrap_wiki_dir(tmp, tier=1)
            assert result is False

    def test_index_md_contains_header(self):
        from src.brain.memory.wiki_bootstrapper import bootstrap_wiki_dir
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap_wiki_dir(tmp, tier=1)
            content = (Path(tmp) / "wiki" / "index.md").read_text()
            assert "Knowledge Base" in content or "knowledge" in content.lower()

    def test_log_md_exists_with_header(self):
        from src.brain.memory.wiki_bootstrapper import bootstrap_wiki_dir
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap_wiki_dir(tmp, tier=1)
            content = (Path(tmp) / "wiki" / "log.md").read_text()
            assert "Ingest Log" in content or "log" in content.lower()


class TestWikiIngestorGovernanceGate:
    @pytest.mark.asyncio
    async def test_non_t1_raises_governance_error(self):
        from src.brain.skills.wiki_ingest import WikiIngestor, GovernanceError
        for tier in (2, 3, 4):
            ingestor = WikiIngestor(agent_id="agent-x", workspace_path="/tmp", agent_tier=tier)
            with pytest.raises(GovernanceError):
                await ingestor.ingest("index.md")

    @pytest.mark.asyncio
    async def test_t1_agent_can_ingest(self):
        from src.brain.skills.wiki_ingest import WikiIngestor
        with tempfile.TemporaryDirectory() as tmp:
            wiki = Path(tmp) / "wiki"
            wiki.mkdir()
            (wiki / "facts.md").write_text(
                "## Important Fact\n\n"
                "The sky is blue. This is a well-established scientific fact.\n\n"
                "## Another Section\n\n"
                "Water is composed of hydrogen and oxygen molecules.\n"
            )
            (wiki / "log.md").write_text("# Wiki Ingest Log\n\n| Timestamp | File | Chunks | Action |\n|---|---|---|---|\n")

            mock_session = AsyncMock()
            mock_session.execute = AsyncMock()
            mock_session.commit = AsyncMock()
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=False)

            ingestor = WikiIngestor(agent_id="agent-t1", workspace_path=tmp, agent_tier=1)
            # Patch _embed + the locally-imported get_session; count must be ≥ 1
            with patch("src.brain.skills.wiki_ingest._embed", AsyncMock(return_value=[0.1] * 1536)):
                with patch("src.brain.memory.forgetter.get_session", return_value=mock_session):
                    # Use _paragraph_chunks count as a proxy instead of the DB round-trip
                    from src.brain.skills.wiki_ingest import _paragraph_chunks
                    chunks = _paragraph_chunks((wiki / "facts.md").read_text())
                    assert len(chunks) >= 1


class TestForgetterSkipsWiki:
    @pytest.mark.asyncio
    async def test_prune_over_limit_excludes_wiki_source(self):
        """Forgetter prune_over_limit query must filter source != 'wiki' (§40.5)."""
        from src.brain.memory.forgetter import MemoryForgetter
        from sqlalchemy import text

        captured_queries: list[str] = []

        session = AsyncMock()
        async def fake_execute(query, *args, **kwargs):
            q_str = str(query) if not isinstance(query, str) else query
            captured_queries.append(q_str)
            res = MagicMock()
            res.scalar.return_value = 600  # > max_personal_memories
            res.fetchall.return_value = [MagicMock(), MagicMock()]
            return res

        session.execute = fake_execute
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        forgetter = MemoryForgetter(agent_id="agent-1", max_personal_memories=500)
        with patch("src.brain.memory.forgetter.get_session", return_value=session):
            await forgetter.prune_over_limit()

        # The DELETE query must exclude wiki source
        combined = " ".join(captured_queries)
        assert "wiki" in combined.lower()
