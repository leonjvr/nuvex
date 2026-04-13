"""Per-org YAML config loader — scans /data/orgs/*/config.yaml and syncs to DB."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

log = logging.getLogger(__name__)

_DATA_ROOT = os.environ.get("NUVEX_DATA_ROOT", "data")


def _data_root() -> Path:
    return Path(os.environ.get("NUVEX_DATA_ROOT", _DATA_ROOT))


def scan_org_configs() -> dict[str, dict[str, Any]]:
    """Return {org_id: raw_config_dict} for all /data/orgs/*/config.yaml files."""
    orgs_dir = _data_root() / "orgs"
    result: dict[str, dict[str, Any]] = {}
    if not orgs_dir.is_dir():
        return result
    for candidate in orgs_dir.iterdir():
        if not candidate.is_dir():
            continue
        config_file = candidate / "config.yaml"
        if not config_file.is_file():
            continue
        try:
            raw = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
            org_id = raw.get("org_id", candidate.name)
            if not org_id:
                log.warning("Skipping org config (missing org_id): %s", config_file)
                continue
            result[org_id] = raw
        except Exception as exc:
            log.warning("Failed to parse org config %s: %s", config_file, exc)
    return result


def load_org_governance(org_id: str) -> dict[str, Any]:
    """Load /data/orgs/{org_id}/governance.yaml into a dict, or {} if absent."""
    gov_file = _data_root() / "orgs" / org_id / "governance.yaml"
    if not gov_file.is_file():
        return {}
    try:
        return yaml.safe_load(gov_file.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        log.warning("Failed to parse governance config for org %s: %s", org_id, exc)
        return {}


async def sync_orgs_to_db(session: Any) -> list[str]:
    """Upsert org and agent rows from YAML configs. Returns list of changed org_ids."""
    from .models.organisation import Organisation

    org_configs = scan_org_configs()
    changed: list[str] = []

    # Legacy fallback: if no orgs dir, use default org
    if not org_configs:
        log.info("No /data/orgs/ configs found — using legacy default org")
        return await _ensure_default_org(session)

    for org_id, raw in org_configs.items():
        existing = await session.get(Organisation, org_id)
        gov = load_org_governance(org_id)
        if existing is None:
            org = Organisation(
                org_id=org_id,
                name=raw.get("name", org_id),
                status=raw.get("status", "active"),
                config=raw.get("config", {}),
                policies=gov or raw.get("policies", {}),
                communication_links=raw.get("communication_links", {}),
            )
            session.add(org)
            changed.append(org_id)
            log.info("org-config-loader: created org %s", org_id)
        else:
            # Update policies from governance.yaml if newer
            if gov and gov != existing.policies:
                existing.policies = gov
                changed.append(org_id)
                log.info("org-config-loader: updated policies for org %s", org_id)

    await session.commit()
    return changed


async def _ensure_default_org(session: Any) -> list[str]:
    """Create the default org if it does not exist."""
    from .models.organisation import Organisation

    existing = await session.get(Organisation, "default")
    if existing is None:
        org = Organisation(
            org_id="default",
            name="Default Organisation",
            status="active",
            config={},
            policies={},
            communication_links={},
        )
        session.add(org)
        await session.commit()
        log.info("org-config-loader: created default org")
        return ["default"]
    return []


async def check_divergence(session: Any) -> list[str]:
    """Check if YAML configs differ from DB; return list of divergent org_ids (§4.7)."""
    from .models.organisation import Organisation

    yaml_configs = scan_org_configs()
    divergent: list[str] = []

    for org_id, raw in yaml_configs.items():
        existing = await session.get(Organisation, org_id)
        if existing is None:
            divergent.append(org_id)
            log.warning("org-config-loader: org '%s' in YAML but not in DB — run config reload", org_id)
            continue

        yaml_policies = load_org_governance(org_id) or raw.get("policies", {})
        if yaml_policies and yaml_policies != (existing.policies or {}):
            divergent.append(org_id)
            log.warning(
                "org-config-loader: org '%s' policies differ between YAML and DB — "
                "run `nuvex config reload` to sync",
                org_id,
            )

    return divergent
