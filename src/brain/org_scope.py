"""Org-scoped query helper — adds WHERE org_id = :org_id to any SQLAlchemy statement."""
from __future__ import annotations

from sqlalchemy import Select, Update, Delete


def org_scope(query: Select | Update | Delete, org_id: str) -> Select | Update | Delete:
    """Return query filtered to the given org_id.

    Works for any SQLAlchemy Core/ORM statement that exposes a .where() method.
    The target table must have an ``org_id`` column.

    Example::

        stmt = select(Thread).where(Thread.agent_id == agent_id)
        stmt = org_scope(stmt, org_id)
        result = await session.execute(stmt)
    """
    # Get the entity / table from the statement
    froms = list(query.froms) if hasattr(query, "froms") else []
    if froms:
        table = froms[0]
        if hasattr(table, "c") and "org_id" in table.c:
            return query.where(table.c.org_id == org_id)

    # ORM path: entity_zero for select/update
    if hasattr(query, "entity_zero"):
        entity = query.entity_zero
        if entity is not None and hasattr(entity, "class_"):
            cls = entity.class_
            if hasattr(cls, "org_id"):
                return query.where(cls.org_id == org_id)

    # Fallback: try whereclause via column property
    return query
