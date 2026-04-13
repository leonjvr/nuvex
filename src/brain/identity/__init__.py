"""Identity subsystem — contact resolution and trust progression."""
from __future__ import annotations

from .resolver import ContactResolution, ContactResolver
from .progression import TrustProgressionService

__all__ = ["ContactResolution", "ContactResolver", "TrustProgressionService"]
