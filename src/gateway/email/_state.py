"""Shared mutable state between server.py and poller.py.

Using a module-level dict avoids the __main__ vs package import split —
when server.py runs as __main__ and poller.py does
``import src.gateway.email.server``, they get *different* module objects.
This helper module is always imported by its full dotted name so both sides
reference the same dict.
"""
from __future__ import annotations

_state: dict[str, str] = {"imap_state": "starting"}


def get_imap_state() -> str:
    return _state["imap_state"]


def set_imap_state(value: str) -> None:
    _state["imap_state"] = value
