"""Stub heavy optional deps so memory-edges tests run without the real packages."""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock


def _stub(name: str, **attrs: object) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)
    return mod


_stub("langchain_openai", ChatOpenAI=MagicMock)
_stub("langchain_anthropic", ChatAnthropic=MagicMock)
