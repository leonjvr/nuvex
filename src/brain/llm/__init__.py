"""LLM package — credential pool registry and helpers.

Loads credential pools from nuvex.yaml at startup.
"""
from __future__ import annotations

import logging
import os
import re

from .credential_pool import CredentialPool, CredentialExhausted

log = logging.getLogger(__name__)

__all__ = ["CredentialPool", "CredentialExhausted", "get_pool", "resolve_api_key"]

_pools: dict[str, CredentialPool] = {}
_initialized = False


def _expand_env(value: str) -> str:
    """Expand ``${ENV_VAR}`` placeholders — missing vars produce empty string."""
    return re.sub(
        r"\$\{([^}]+)\}",
        lambda m: os.environ.get(m.group(1), ""),
        value,
    )


def initialize_pools() -> None:
    """Load credential pools from nuvex.yaml config.  Called at brain startup."""
    global _initialized
    if _initialized:
        return
    try:
        from ...shared.config import get_cached_config

        cfg = get_cached_config()
        for provider, pool_cfg in cfg.llm.credential_pools.providers.items():
            keys = [_expand_env(k) for k in pool_cfg.keys]
            keys = [k for k in keys if k]  # drop empty (unset env vars)
            if not keys:
                log.debug("credential_pool: no keys for provider=%s — skipping", provider)
                continue
            _pools[provider] = CredentialPool(
                provider=provider,
                keys=keys,
                strategy=pool_cfg.strategy,
                cooldown_minutes=pool_cfg.cooldown_minutes,
            )
            log.info(
                "credential_pool: provider=%s keys=%d strategy=%s",
                provider,
                len(keys),
                pool_cfg.strategy,
            )
    except Exception as exc:
        log.warning("credential_pool: init failed (non-fatal): %s", exc)
    _initialized = True


def get_pool(provider: str) -> CredentialPool | None:
    """Return the pool for *provider*, or None if not configured."""
    if not _initialized:
        initialize_pools()
    return _pools.get(provider)


def resolve_api_key(provider: str, env_var: str) -> str:
    """Return the next API key for *provider*.

    Falls back to the plain env var if no pool is configured (single-key path,
    fully backward-compatible).
    """
    pool = get_pool(provider)
    if pool is not None:
        return pool.get_key()
    return os.environ.get(env_var, "")
