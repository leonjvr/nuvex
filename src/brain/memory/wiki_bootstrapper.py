"""Wiki workspace bootstrapper — creates wiki/ directory for T1 agents (§40.1)."""
from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

_WIKI_INDEX_TEMPLATE = """# Agent Knowledge Base

This directory contains curated knowledge for this agent.

## How to use

Add markdown files to this directory. The `wiki_ingest` skill will chunk
and embed them automatically.

## Index

*(automatically maintained by wiki_ingest)*
"""

_WIKI_LOG_TEMPLATE = """# Wiki Ingest Log

| Timestamp | File | Chunks | Action |
|-----------|------|--------|--------|
"""


def bootstrap_wiki_dir(workspace_path: str, tier: int) -> bool:
    """Create wiki/ directory with index.md and log.md for T1 agents only.

    Returns True if the wiki directory was created, False if skipped or already exists.
    Tier 1 = T1. Higher tier numbers = lower access level in NUVEX convention.
    """
    if tier not in (1,):
        log.debug("wiki_bootstrapper: skipping wiki/ (tier %d, requires T1)", tier)
        return False

    wiki_dir = Path(workspace_path) / "wiki"
    if wiki_dir.exists():
        log.debug("wiki_bootstrapper: wiki/ already exists at %s", wiki_dir)
        return False

    try:
        wiki_dir.mkdir(parents=True, exist_ok=True)
        (wiki_dir / "index.md").write_text(_WIKI_INDEX_TEMPLATE, encoding="utf-8")
        (wiki_dir / "log.md").write_text(_WIKI_LOG_TEMPLATE, encoding="utf-8")
        log.info("wiki_bootstrapper: created wiki/ at %s", wiki_dir)
        return True
    except OSError as exc:
        log.warning("wiki_bootstrapper: failed to create wiki/: %s", exc)
        return False
