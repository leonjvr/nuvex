"""Unit tests — governance: data classification tier checks."""
from __future__ import annotations

import pytest
from src.brain.governance.classification import (
    DataClass,
    _infer_classification,
    _TIER_MAX,
)


class TestDataClassEnum:
    def test_ordering(self):
        assert DataClass.PUBLIC < DataClass.INTERNAL
        assert DataClass.INTERNAL < DataClass.CONFIDENTIAL
        assert DataClass.CONFIDENTIAL < DataClass.RESTRICTED


class TestInferClassification:
    def test_shell_is_confidential(self):
        assert _infer_classification("shell", {}) == DataClass.CONFIDENTIAL

    def test_web_fetch_is_public(self):
        assert _infer_classification("web_fetch", {}) == DataClass.PUBLIC

    def test_read_file_is_internal(self):
        assert _infer_classification("read_file", {}) == DataClass.INTERNAL

    def test_sensitive_path_escalates_to_restricted(self):
        assert _infer_classification("read_file", {"path": "/root/.env"}) == DataClass.RESTRICTED
        assert _infer_classification("read_file", {"path": "/etc/passwd"}) == DataClass.RESTRICTED
        assert _infer_classification("read_file", {"path": "/secrets/key"}) == DataClass.RESTRICTED

    def test_credential_in_command_escalates_to_restricted(self):
        assert _infer_classification("shell", {"command": "cat ~/.ssh/private_key"}) == DataClass.RESTRICTED

    def test_unknown_tool_defaults_to_internal(self):
        assert _infer_classification("custom_tool", {}) == DataClass.INTERNAL


class TestTierMaxPermissions:
    def test_t1_has_full_access(self):
        assert _TIER_MAX["T1"] == DataClass.RESTRICTED

    def test_t4_is_public_only(self):
        assert _TIER_MAX["T4"] == DataClass.PUBLIC

    def test_t2_can_access_confidential_not_restricted(self):
        assert _TIER_MAX["T2"] == DataClass.CONFIDENTIAL
        assert _TIER_MAX["T2"] < DataClass.RESTRICTED

    def test_t3_can_access_internal(self):
        assert _TIER_MAX["T3"] == DataClass.INTERNAL
