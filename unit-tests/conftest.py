"""Shared pytest configuration for the unit-tests suite.

All tests here are pure-Python unit tests — no database, no Docker required.
Database-touching code is always mocked via AsyncMock / MagicMock.
"""
from __future__ import annotations

import sys
import os

# Ensure the repo root is on sys.path so `from src.brain...` imports work
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
