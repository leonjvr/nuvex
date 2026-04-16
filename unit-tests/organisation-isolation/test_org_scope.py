"""Tests for org_scope helper — task 18.2."""
from __future__ import annotations

import pytest
from sqlalchemy import String, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class _Base(DeclarativeBase):
    pass


class _FakeTable(_Base):
    __tablename__ = "fake_org_table"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    org_id: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)


class _AnotherTable(_Base):
    __tablename__ = "another_org_table"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    org_id: Mapped[str] = mapped_column(String)


class TestOrgScope:
    """18.2 — org_scope adds WHERE clause correctly."""

    def test_org_scope_adds_where_to_orm_select(self):
        """org_scope on an ORM select must add a WHERE org_id clause."""
        from src.brain.org_scope import org_scope

        q = select(_FakeTable)
        scoped = org_scope(q, "acme")

        # Must have a whereclause now
        assert scoped.whereclause is not None
        compiled = str(scoped.compile())
        assert "org_id" in compiled

    def test_org_scope_filters_to_correct_org(self):
        """Bound param must match the org_id we pass in."""
        from src.brain.org_scope import org_scope

        q = select(_AnotherTable)
        scoped = org_scope(q, "target-org")

        params = scoped.compile().params
        assert "target-org" in params.values()

    def test_org_scope_returns_statement(self):
        """org_scope must return a statement object (not None, not str)."""
        from src.brain.org_scope import org_scope

        q = select(_FakeTable)
        result = org_scope(q, "some-org")
        assert result is not None
        assert hasattr(result, "whereclause")

    def test_org_scope_chaining(self):
        """org_scope result can be filtered further without errors."""
        from src.brain.org_scope import org_scope

        q = select(_FakeTable)
        scoped = org_scope(q, "org-a")
        further = scoped.where(_FakeTable.name == "test")
        compiled = str(further.compile())
        assert "org_id" in compiled
        assert "name" in compiled

