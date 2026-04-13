"""Unit tests for CredentialPool (hermes-inspired-runtime §3)."""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from src.brain.llm.credential_pool import CredentialPool, CredentialExhausted


class TestCredentialPoolSingleKey:
    def test_single_key_fill_first(self):
        pool = CredentialPool("test", ["key1"], strategy="fill_first", cooldown_minutes=60)
        assert pool.get_key() == "key1"

    def test_single_key_report_success(self):
        pool = CredentialPool("test", ["key1"])
        pool.report_success("key1")
        assert pool.active_count() == 1

    def test_single_key_429_cooldown_exhausted(self):
        pool = CredentialPool("test", ["key1"], cooldown_minutes=60)
        pool.report_failure("key1", 429)
        with pytest.raises(CredentialExhausted):
            pool.get_key()

    def test_402_also_triggers_cooldown(self):
        pool = CredentialPool("test", ["key1"], cooldown_minutes=60)
        pool.report_failure("key1", 402)
        assert pool.all_exhausted()

    def test_non_rate_limit_status_no_cooldown(self):
        pool = CredentialPool("test", ["key1"])
        pool.report_failure("key1", 500)
        # 500 should not trigger cooldown
        assert pool.active_count() == 1


class TestCredentialPoolMultiKey:
    def test_fill_first_stays_on_first_key(self):
        pool = CredentialPool("test", ["k1", "k2", "k3"], strategy="fill_first")
        keys = [pool.get_key() for _ in range(5)]
        assert all(k == "k1" for k in keys)

    def test_fill_first_advances_on_cooldown(self):
        pool = CredentialPool("test", ["k1", "k2"], strategy="fill_first", cooldown_minutes=60)
        pool.report_failure("k1", 429)
        assert pool.get_key() == "k2"

    def test_round_robin_cycles(self):
        pool = CredentialPool("test", ["k1", "k2", "k3"], strategy="round_robin")
        keys = [pool.get_key() for _ in range(6)]
        assert keys[:3] == ["k1", "k2", "k3"]
        assert keys[3:] == ["k1", "k2", "k3"]

    def test_round_robin_skips_cooldown(self):
        pool = CredentialPool("test", ["k1", "k2", "k3"], strategy="round_robin", cooldown_minutes=60)
        pool.report_failure("k2", 429)
        keys = {pool.get_key() for _ in range(6)}
        assert "k2" not in keys

    def test_random_selects_available(self):
        pool = CredentialPool("test", ["k1", "k2"], strategy="random", cooldown_minutes=60)
        pool.report_failure("k1", 429)
        for _ in range(10):
            assert pool.get_key() == "k2"

    def test_all_exhausted_raises_credential_exhausted(self):
        pool = CredentialPool("test", ["k1", "k2"], cooldown_minutes=60)
        pool.report_failure("k1", 429)
        pool.report_failure("k2", 429)
        with pytest.raises(CredentialExhausted):
            pool.get_key()

    def test_cooldown_expiry_reactivates_key(self):
        pool = CredentialPool("test", ["k1"], cooldown_minutes=0)  # 0 min = immediate
        pool.report_failure("k1", 429)
        # cooldown_seconds = 0 * 60 = 0 — key immediately available again
        time.sleep(0.01)
        assert pool.get_key() == "k1"

    def test_api_key_not_in_report_failure_logs(self, caplog):
        import logging

        pool = CredentialPool("test", ["supersecretkey123"], cooldown_minutes=1)
        with caplog.at_level(logging.WARNING):
            pool.report_failure("supersecretkey123", 429)
        for record in caplog.records:
            assert "supersecretkey123" not in record.message, (
                "API key must never appear in log messages"
            )

    def test_active_count(self):
        pool = CredentialPool("test", ["k1", "k2", "k3"], cooldown_minutes=60)
        assert pool.active_count() == 3
        pool.report_failure("k1", 429)
        assert pool.active_count() == 2

    def test_empty_keys_raises(self):
        with pytest.raises(ValueError):
            CredentialPool("test", [])
