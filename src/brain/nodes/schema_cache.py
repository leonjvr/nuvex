"""Tool schema hashing and cache — §33.

Deterministic schema serialisation so Anthropic's prompt cache stays warm
across consecutive invocations where the tool set hasn't changed.
"""
from __future__ import annotations

import hashlib
import json


def compute_schema_hash(tools: list) -> tuple[str, list[dict]]:
    """Serialize tool schemas deterministically and return (sha256_hex, schema_dicts).

    Schema dicts are sorted by tool name; every level of the JSON is serialised
    with sort_keys=True so that two invocations with identical tools — regardless
    of dict insertion order — always produce the same hash (§33).
    """
    schema_dicts: list[dict] = []
    for tool in tools:
        if tool.args_schema is not None:
            if isinstance(tool.args_schema, dict):
                params = tool.args_schema
            else:
                try:
                    params = tool.args_schema.model_json_schema()  # Pydantic v2
                except AttributeError:
                    try:
                        params = tool.args_schema.schema()  # Pydantic v1
                    except AttributeError:
                        params = {}
        else:
            params = {}
        schema_dicts.append({
            "name": tool.name,
            "description": tool.description or "",
            "parameters": params,
        })
    schema_dicts.sort(key=lambda s: s["name"])
    serialized = json.dumps(schema_dicts, sort_keys=True)
    digest = hashlib.sha256(serialized.encode()).hexdigest()
    return digest, schema_dicts


# Legacy alias — used by unit-tests that imported the private name directly
_compute_schema_hash = compute_schema_hash
