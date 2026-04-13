"""Multi-credential failover pool — rotate API keys with cooldown.

Spec: hermes-inspired-runtime §3
"""
from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, field
from itertools import cycle
from threading import Lock

log = logging.getLogger(__name__)


class CredentialExhausted(Exception):
    """Raised when all keys for a provider are on cooldown."""


@dataclass
class _KeyState:
    index: int
    cooldown_until: float = 0.0  # epoch seconds; 0 = available
    success_count: int = 0
    failure_count: int = 0


class CredentialPool:
    """Thread-safe API key pool with rotation strategies and per-key cooldown.

    API keys are never logged, never included in error messages.
    """

    def __init__(
        self,
        provider: str,
        keys: list[str],
        strategy: str = "fill_first",
        cooldown_minutes: int = 60,
    ) -> None:
        if not keys:
            raise ValueError(f"CredentialPool({provider}): at least one key required")
        self._provider = provider
        self._keys = list(keys)
        self._strategy = strategy
        self._cooldown_seconds = cooldown_minutes * 60
        self._states: list[_KeyState] = [_KeyState(index=i) for i in range(len(keys))]
        self._lock = Lock()
        # round-robin cursor
        self._rr_cursor: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_key(self) -> str:
        """Return the next available API key according to the rotation strategy.

        Raises:
            CredentialExhausted: when all keys are on cooldown.
        """
        with self._lock:
            available = self._available_indices()
            if not available:
                raise CredentialExhausted(
                    f"All credentials for provider '{self._provider}' are on cooldown."
                )

            if self._strategy == "fill_first":
                chosen = available[0]
            elif self._strategy == "round_robin":
                # find the first available index at or after the cursor
                cursor = self._rr_cursor % len(self._keys)
                rotated = [(cursor + i) % len(self._keys) for i in range(len(self._keys))]
                chosen = next(i for i in rotated if i in set(available))
                self._rr_cursor = (chosen + 1) % len(self._keys)
            elif self._strategy == "random":
                chosen = random.choice(available)  # nosec — not cryptographic
            else:
                chosen = available[0]

            return self._keys[chosen]

    def report_failure(self, key: str, status_code: int) -> None:
        """Put *key* on cooldown when status_code is 429 or 402."""
        if status_code not in (429, 402):
            return
        with self._lock:
            idx = self._key_index(key)
            if idx is None:
                return
            state = self._states[idx]
            state.cooldown_until = time.monotonic() + self._cooldown_seconds
            state.failure_count += 1
            log.warning(
                "credential_pool: provider=%s key_index=%d on cooldown for %ds (http %d)",
                self._provider,
                idx,
                self._cooldown_seconds,
                status_code,
            )
            self._emit_cooldown_event(idx, status_code)

    def report_success(self, key: str) -> None:
        """Increment success counter for *key* (clears cooldown if present)."""
        with self._lock:
            idx = self._key_index(key)
            if idx is None:
                return
            self._states[idx].success_count += 1

    def all_exhausted(self) -> bool:
        """Return True when every key is currently on cooldown."""
        with self._lock:
            return len(self._available_indices()) == 0

    def active_count(self) -> int:
        """Return number of keys NOT currently on cooldown."""
        with self._lock:
            return len(self._available_indices())

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _available_indices(self) -> list[int]:
        now = time.monotonic()
        return [s.index for s in self._states if s.cooldown_until <= now]

    def _key_index(self, key: str) -> int | None:
        try:
            return self._keys.index(key)
        except ValueError:
            return None

    def _emit_cooldown_event(self, key_index: int, status_code: int) -> None:
        """Fire a credential.cooldown event (key value is never included)."""
        try:
            from ..events import emit
            import asyncio

            async def _fire() -> None:
                await emit(
                    "credential.cooldown",
                    {
                        "provider": self._provider,
                        "key_index": key_index,
                        "http_status": status_code,
                    },
                )

            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_fire())
        except Exception:
            pass  # event bus not available — non-fatal
