"""Conftest for email-gateway tests.

Stubs out third-party deps not installed in the unit-test environment and
sets required environment variables before the poller module is imported.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

# Stub gateway-only deps — always override so tests run correctly regardless
# of which other test files (e.g. dashboard/) registered bare ModuleType stubs first.
for _mod in ("aioimaplib", "aiosmtplib"):
    sys.modules[_mod] = MagicMock()

# Set required env vars so the module-level os.environ reads don't raise
_DEFAULTS = {
    "BRAIN_URL": "http://brain:8100",
    "NUVEX_AGENT_ID": "maya",
    "NUVEX_ORG_ID": "testorg",
    "IMAP_HOST": "mail.example.com",
    "IMAP_PORT": "993",
    "SMTP_HOST": "smtp.example.com",
    "SMTP_PORT": "587",
    "EMAIL_USER": "maya@example.com",
    "EMAIL_PASS": "secret",
}
for k, v in _DEFAULTS.items():
    os.environ.setdefault(k, v)
