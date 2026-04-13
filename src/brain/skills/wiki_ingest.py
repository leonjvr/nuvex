"""Wiki ingest skill — chunk, embed, and upsert markdown docs into memories (§40.2–40.4)."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_CHUNK_MIN_CHARS = 40
_SOURCE_TAG = "wiki"
_WIKI_CONFIDENCE = 1.0


class GovernanceError(Exception):
    """Raised when a non-T1 agent attempts wiki ingest (§40.4)."""


def _paragraph_chunks(text: str, max_chars: int = 800) -> list[str]:
    """Split markdown into paragraph-level chunks (§40.2).

    Splits on double-newline boundaries. Chunks exceeding max_chars are
    sub-split at single newline. Very short paragraphs are skipped.
    """
    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    for para in paragraphs:
        para = para.strip()
        if len(para) < _CHUNK_MIN_CHARS:
            continue
        if len(para) <= max_chars:
            chunks.append(para)
        else:
            for line in para.split("\n"):
                line = line.strip()
                if len(line) >= _CHUNK_MIN_CHARS:
                    chunks.append(line)
    return chunks


async def _embed(text_: str) -> list[float] | None:
    try:
        import openai
        client = openai.AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        resp = await client.embeddings.create(model="text-embedding-3-small", input=text_)
        return resp.data[0].embedding
    except Exception as exc:
        log.warning("wiki_ingest: embed failed: %s", exc)
        return None


class WikiIngestor:
    """Ingest a markdown file from the agent wiki/ directory into memories (§40).

    Only T1 agents are allowed to use this skill (§40.4).
    Wiki memories are tagged with ``source='wiki'`` and ``confidence=1.0`` (§40.3).
    """

    def __init__(self, agent_id: str, workspace_path: str, agent_tier: int) -> None:
        self.agent_id = agent_id
        self.workspace_path = workspace_path
        self.agent_tier = agent_tier

    def _require_t1(self) -> None:
        """Raise GovernanceError if agent is not T1 (§40.4)."""
        if self.agent_tier != 1:
            raise GovernanceError(
                f"wiki_ingest: agent {self.agent_id} is tier {self.agent_tier}; "
                "only T1 agents may ingest wiki documents"
            )

    async def ingest(self, filename: str) -> int:
        """Chunk, embed, and upsert a wiki markdown file. Returns chunk count written."""
        self._require_t1()

        wiki_dir = Path(self.workspace_path) / "wiki"
        file_path = wiki_dir / filename
        if not file_path.exists():
            log.warning("wiki_ingest: file not found: %s", file_path)
            return 0

        text = file_path.read_text(encoding="utf-8")
        chunks = _paragraph_chunks(text)
        if not chunks:
            log.info("wiki_ingest: no usable chunks in %s", filename)
            return 0

        from ..db import get_session
        from sqlalchemy import text as _text

        written = 0
        for chunk in chunks:
            embedding = await _embed(chunk)
            embedding_str = ("[" + ",".join(str(v) for v in embedding) + "]") if embedding else None
            try:
                async with get_session() as session:
                    await session.execute(
                        _text("""
                            INSERT INTO memories
                                (agent_id, content, embedding, scope, owner_id, confidence,
                                 source, source_agent, access_tier)
                            VALUES
                                (:agent_id, :content, :embedding::vector, 'personal',
                                 :agent_id, :confidence, :source, :agent_id, 1)
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "agent_id": self.agent_id,
                            "content": chunk,
                            "embedding": embedding_str,
                            "confidence": _WIKI_CONFIDENCE,
                            "source": _SOURCE_TAG,
                        },
                    )
                    await session.commit()
                written += 1
            except Exception as exc:
                log.warning("wiki_ingest: chunk upsert failed: %s", exc)

        # Append to log.md (§40.3)
        self._append_log(wiki_dir, filename, written)

        log.info("wiki_ingest: ingested %d chunks from %s", written, filename)
        return written

    def _append_log(self, wiki_dir: Path, filename: str, chunk_count: int) -> None:
        log_path = wiki_dir / "log.md"
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
        try:
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"| {timestamp} | {filename} | {chunk_count} | ingested |\n")
        except OSError as exc:
            log.warning("wiki_ingest: could not append to log.md: %s", exc)
