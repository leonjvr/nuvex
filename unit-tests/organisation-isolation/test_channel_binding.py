"""Unit tests — channel binding uniqueness (§18.7)."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


class TestChannelBindingModel:
    """Structural validation of ChannelBinding SQLAlchemy model."""

    def test_model_has_required_columns(self):
        from src.brain.models.channel_binding import ChannelBinding
        assert hasattr(ChannelBinding, "id")
        assert hasattr(ChannelBinding, "org_id")
        assert hasattr(ChannelBinding, "channel_type")
        assert hasattr(ChannelBinding, "channel_identity")
        assert hasattr(ChannelBinding, "config")
        assert hasattr(ChannelBinding, "created_at")

    def test_unique_constraint_declared(self):
        from src.brain.models.channel_binding import ChannelBinding
        constraints = [str(c) for c in ChannelBinding.__table_args__]
        # Confirm the UniqueConstraint for type+identity exists
        assert any("channel_type" in c and "channel_identity" in c for c in constraints)

    def test_tablename(self):
        from src.brain.models.channel_binding import ChannelBinding
        assert ChannelBinding.__tablename__ == "channel_bindings"


class TestChannelBindingRouter:
    """Basic endpoint existence checks for the channels router (§10.2)."""

    def test_router_has_list_route(self):
        from src.brain.routers.channels import router
        paths = [r.path for r in router.routes]
        assert any("/channels" in p for p in paths)

    def test_router_has_create_route(self):
        from src.brain.routers.channels import router
        from fastapi.routing import APIRoute
        post_routes = [
            r for r in router.routes
            if isinstance(r, APIRoute) and "POST" in r.methods
        ]
        assert post_routes, "channels router must have at least one POST route"

    def test_router_has_delete_route(self):
        from src.brain.routers.channels import router
        from fastapi.routing import APIRoute
        delete_routes = [
            r for r in router.routes
            if isinstance(r, APIRoute) and "DELETE" in r.methods
        ]
        assert delete_routes, "channels router must have at least one DELETE route"


class TestChannelBindingOrgScoping:
    """Validate that channel bindings enforce org_id scoping at the model level."""

    def test_org_id_is_not_nullable(self):
        from src.brain.models.channel_binding import ChannelBinding
        col = ChannelBinding.__table__.columns["org_id"]
        assert not col.nullable

    def test_channel_type_is_not_nullable(self):
        from src.brain.models.channel_binding import ChannelBinding
        col = ChannelBinding.__table__.columns["channel_type"]
        assert not col.nullable

    def test_channel_identity_is_not_nullable(self):
        from src.brain.models.channel_binding import ChannelBinding
        col = ChannelBinding.__table__.columns["channel_identity"]
        assert not col.nullable
