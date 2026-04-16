"""Plugin import CLI — `nuvex plugins import <path>`.

Converts an OpenClaw TypeScript plugin into NUVEX-compatible Python tools.
"""
from __future__ import annotations

import json
import re
import textwrap
from pathlib import Path
from typing import Any

from .converter import convert_typebox


_REGISTER_START_RE = re.compile(r"api\.registerTool\s*\(\s*")
_NAME_RE = re.compile(r'name\s*:\s*["\']([^"\']+)["\']')
_DESC_RE = re.compile(r'description\s*:\s*["\']([^"\']+)["\']')
_PARAMS_RE = re.compile(r'parameters\s*:\s*Type\.Object\s*\(\s*\{(.+?)\}\s*\)', re.DOTALL)
_FIELD_NAME_RE = re.compile(r"(\w+)\s*:\s*")


def _find_balanced_braces(text: str, start: int) -> tuple[int, int] | None:
    """Return (open_idx, close_idx+1) of balanced {} starting at or after start."""
    idx = text.find("{", start)
    if idx == -1:
        return None
    depth = 0
    for i in range(idx, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return idx, i + 1
    return None


def _extract_type_expr(text: str, start: int) -> str:
    """Extract a complete TypeBox expression starting at start using paren balancing."""
    depth = 0
    end = start
    while end < len(text):
        ch = text[end]
        if ch == "(":
            depth += 1
        elif ch == ")":
            if depth == 0:
                break
            depth -= 1
            if depth == 0:
                end += 1
                break
        elif ch in (",", "\n", ";") and depth == 0:
            break
        end += 1
    return text[start:end].strip().rstrip(",")


def _to_class_name(tool_name: str) -> str:
    """Convert tool name (snake_case or camelCase) to PascalCaseTool."""
    words = re.split(r"[_\-\s]+", tool_name)
    return "".join(w.capitalize() for w in words) + "Tool"


def _extract_tools(ts_source: str) -> list[dict[str, Any]]:
    """Extract registerTool() call data from TypeScript source."""
    tools: list[dict[str, Any]] = []
    for m in _REGISTER_START_RE.finditer(ts_source):
        bounds = _find_balanced_braces(ts_source, m.end())
        if bounds is None:
            continue
        open_idx, close_idx = bounds
        body = ts_source[open_idx + 1 : close_idx - 1]

        name_m = _NAME_RE.search(body)
        desc_m = _DESC_RE.search(body)
        if not name_m:
            continue

        params: dict[str, str] = {}
        params_m = _PARAMS_RE.search(body)
        if params_m:
            props_body = params_m.group(1)
            for fn_m in _FIELD_NAME_RE.finditer(props_body):
                field_start = fn_m.end()
                if not props_body[field_start:].startswith("Type."):
                    continue
                typebox_expr = _extract_type_expr(props_body, field_start)
                if typebox_expr:
                    params[fn_m.group(1)] = convert_typebox(typebox_expr)

        tools.append(
            {
                "name": name_m.group(1),
                "description": desc_m.group(1) if desc_m else "",
                "params": params,
                "ts_body": body,
            }
        )
    return tools


def _render_tool_class(tool: dict[str, Any]) -> str:
    """Render a Python BaseTool subclass from extracted tool data."""
    class_name = _to_class_name(tool["name"])
    params = tool["params"]
    needs_any = any("Any" in v for v in params.values())
    imports = ["from __future__ import annotations", "from langchain_core.tools import BaseTool",
               "from pydantic import BaseModel, Field"]
    if needs_any:
        imports.append("from typing import Any")

    param_fields = "\n".join(
        f"    {name}: {typ} = Field(description='')"
        for name, typ in params.items()
    )
    schema_class = f"class _{class_name}Input(BaseModel):\n{param_fields or '    pass'}\n"

    run_args = ", ".join(f"{n}: {t}" for n, t in params.items()) or ""
    ts_ref = textwrap.indent(tool["ts_body"].strip(), "    # ")
    run_body = (
        f'        """Stub — implement this method.\n'
        f'        Original TypeScript body:\n{ts_ref}\n'
        f'        """\n'
        f"        raise NotImplementedError"
    )

    tool_class = (
        f"class {class_name}(BaseTool):\n"
        f"    name: str = {tool['name']!r}\n"
        f"    description: str = {tool['description']!r}\n"
        f"    args_schema: type[BaseModel] = _{class_name}Input\n\n"
        f"    async def _arun(self, {run_args}) -> str:\n"
        f"{run_body}\n"
    )
    return "\n".join(imports) + "\n\n" + schema_class + "\n" + tool_class


def import_plugin(plugin_path: str, output_dir: str | None = None) -> Path:
    """Import an OpenClaw plugin directory and generate Python tools.

    Args:
        plugin_path: Path to the OpenClaw plugin directory (containing manifest.json).
        output_dir:  Where to write the output. Defaults to
                     ``src/brain/tools/imported/<plugin_name>/``.

    Returns:
        Path to the generated package directory.
    """
    plugin = Path(plugin_path).resolve()
    manifest_file = plugin / "manifest.json"
    if not manifest_file.is_file():
        raise FileNotFoundError(f"manifest.json not found in {plugin}")

    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    plugin_name = manifest.get("name", plugin.name).replace("/", "_").replace("-", "_")

    dest_root = Path(output_dir) if output_dir else (
        Path(__file__).parent / "tools" / "imported" / plugin_name
    )
    dest_root.mkdir(parents=True, exist_ok=True)

    # Scan all .ts files for registerTool calls
    all_tools: list[dict[str, Any]] = []
    for ts_file in sorted(plugin.rglob("*.ts")):
        source = ts_file.read_text(encoding="utf-8", errors="replace")
        all_tools.extend(_extract_tools(source))

    if not all_tools:
        raise ValueError(f"No api.registerTool() calls found in {plugin}")

    tool_files: list[tuple[str, str]] = []
    for tool in all_tools:
        class_name = _to_class_name(tool["name"])
        fname = f"{tool['name']}.py"
        (dest_root / fname).write_text(_render_tool_class(tool), encoding="utf-8")
        tool_files.append((class_name, fname))

    # Generate __init__.py
    exports = "\n".join(
        f"from .{fn[:-3]} import {cls}" for cls, fn in tool_files
    )
    all_list = ", ".join(f'"{cls}"' for cls, _ in tool_files)
    init_content = (
        f'"""Auto-generated from OpenClaw plugin: {manifest.get("name", plugin_name)}"""\n'
        f"{exports}\n\n"
        f"__all__ = [{all_list}]\n"
    )
    (dest_root / "__init__.py").write_text(init_content, encoding="utf-8")

    # Generate SKILL.md
    skill_md = (
        f"---\n"
        f"name: {plugin_name}\n"
        f"description: {manifest.get('description', '')}\n"
        f"license: {manifest.get('license', 'unknown')}\n"
        f"---\n\n"
        f"# {plugin_name}\n\n"
        f"Auto-converted from OpenClaw plugin `{manifest.get('name', plugin_name)}`.\n"
    )
    (dest_root / "SKILL.md").write_text(skill_md, encoding="utf-8")

    return dest_root


def main_plugins(args: list[str]) -> int:
    """Entry point for `nuvex plugins` sub-commands."""
    import sys
    if len(args) < 2 or args[0] != "import":
        print("Usage: nuvex plugins import <path>", file=sys.stderr)
        return 1
    plugin_path = args[1]
    try:
        dest = import_plugin(plugin_path)
        print(f"Imported to: {dest}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

