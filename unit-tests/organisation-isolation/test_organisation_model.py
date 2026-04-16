"""Tests for Organisation Pydantic model — task 18.1."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.shared.models.organisation import OrganisationCreate, validate_status_transition


class TestOrganisationCreate:
    """18.1 — OrganisationCreate validation."""

    def test_valid_org_id(self):
        org = OrganisationCreate(org_id="acme-corp", name="Acme")
        assert org.org_id == "acme-corp"

    def test_valid_minimal_org_id(self):
        # minimum 2 chars: start + end char (a-z0-9)
        org = OrganisationCreate(org_id="ab", name="AB")
        assert org.org_id == "ab"

    def test_invalid_org_id_starts_with_dash(self):
        with pytest.raises(ValidationError):
            OrganisationCreate(org_id="-invalid", name="X")

    def test_invalid_org_id_ends_with_dash(self):
        with pytest.raises(ValidationError):
            OrganisationCreate(org_id="invalid-", name="X")

    def test_invalid_org_id_uppercase(self):
        with pytest.raises(ValidationError):
            OrganisationCreate(org_id="UPPER", name="X")

    def test_invalid_org_id_spaces(self):
        with pytest.raises(ValidationError):
            OrganisationCreate(org_id="has space", name="X")

    def test_invalid_org_id_too_long(self):
        with pytest.raises(ValidationError):
            OrganisationCreate(org_id="a" * 65, name="X")

    def test_valid_org_id_with_numbers(self):
        org = OrganisationCreate(org_id="org123", name="Org")
        assert org.org_id == "org123"


class TestStatusTransitions:
    """18.1 — Status lifecycle enforcement."""

    def test_active_to_suspended(self):
        assert validate_status_transition("active", "suspended") is True

    def test_suspended_to_archived(self):
        assert validate_status_transition("suspended", "archived") is True

    def test_suspended_to_active(self):
        assert validate_status_transition("suspended", "active") is True

    def test_active_to_archived_invalid(self):
        assert validate_status_transition("active", "archived") is False

    def test_archived_to_active_invalid(self):
        assert validate_status_transition("archived", "active") is False

    def test_same_status_rejected(self):
        assert validate_status_transition("active", "active") is False

    def test_unknown_target_rejected(self):
        assert validate_status_transition("active", "deleted") is False
