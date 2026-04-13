"""TypeBox → Pydantic type converter for OpenClaw plugin import.

Supported TypeBox mappings:
  Type.String()    → str
  Type.Number()    → float
  Type.Boolean()   → bool
  Type.Optional(T) → T | None
  Type.Array(T)    → list[T]
  Unknown / other  → Any   (with TODO comment)
"""
from __future__ import annotations

import re


_TYPEBOX_MAP: dict[str, str] = {
    "Type.String()": "str",
    "Type.Number()": "float",
    "Type.Boolean()": "bool",
    "Type.Integer()": "int",
    "Type.Null()": "None",
    "Type.Any()": "Any",
    "Type.Unknown()": "Any",
}

_WRAPPER_RE = re.compile(
    r"Type\.(Optional|Array|Union)\((.+)\)$", re.DOTALL
)


def convert_typebox(typebox_expr: str) -> str:
    """Convert a TypeBox expression string to a Python type annotation.

    Args:
        typebox_expr: A TypeBox expression like ``Type.String()`` or
                      ``Type.Optional(Type.Number())``.

    Returns:
        Python type annotation string.
    """
    expr = typebox_expr.strip()

    # Direct mapping
    if expr in _TYPEBOX_MAP:
        return _TYPEBOX_MAP[expr]

    # Wrapper types
    m = _WRAPPER_RE.match(expr)
    if m:
        wrapper = m.group(1)
        inner_expr = m.group(2).strip()
        inner = convert_typebox(inner_expr)
        if wrapper == "Optional":
            return f"{inner} | None"
        if wrapper == "Array":
            return f"list[{inner}]"
        if wrapper == "Union":
            # Handle simple two-arg union
            parts = _split_args(inner_expr)
            converted = [convert_typebox(p) for p in parts]
            return " | ".join(converted)

    # Fallback — emit Any with a TODO comment
    return f"Any  # TODO: convert {expr!r}"


def _split_args(expr: str) -> list[str]:
    """Split a comma-separated TypeBox argument expression respecting parentheses."""
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for ch in expr:
        if ch == "," and depth == 0:
            parts.append("".join(current).strip())
            current = []
        else:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            current.append(ch)
    if current:
        parts.append("".join(current).strip())
    return parts
