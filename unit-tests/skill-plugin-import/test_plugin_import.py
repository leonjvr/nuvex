"""Unit tests for Section 11 — OpenClaw plugin import CLI."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


class TestTypeBoxConverter:
    """11.3 — TypeBox→Pydantic type conversion."""

    def test_string(self):
        from src.brain.plugin_converter import convert_typebox
        assert convert_typebox("Type.String()") == "str"

    def test_number(self):
        from src.brain.plugin_converter import convert_typebox
        assert convert_typebox("Type.Number()") == "float"

    def test_boolean(self):
        from src.brain.plugin_converter import convert_typebox
        assert convert_typebox("Type.Boolean()") == "bool"

    def test_integer(self):
        from src.brain.plugin_converter import convert_typebox
        assert convert_typebox("Type.Integer()") == "int"

    def test_optional(self):
        from src.brain.plugin_converter import convert_typebox
        result = convert_typebox("Type.Optional(Type.String())")
        assert result == "str | None"

    def test_array(self):
        from src.brain.plugin_converter import convert_typebox
        result = convert_typebox("Type.Array(Type.Number())")
        assert result == "list[float]"

    def test_any(self):
        from src.brain.plugin_converter import convert_typebox
        assert convert_typebox("Type.Any()") == "Any"

    def test_unknown_type_falls_back_to_any(self):
        from src.brain.plugin_converter import convert_typebox
        result = convert_typebox("Type.SomeFutureThing()")
        assert "Any" in result
        assert "TODO" in result

    def test_nested_optional_array(self):
        from src.brain.plugin_converter import convert_typebox
        result = convert_typebox("Type.Optional(Type.Array(Type.String()))")
        assert result == "list[str] | None"


class TestPluginImport:
    """11.4/11.5 — import_plugin generates Python tools from TS source."""

    @pytest.fixture
    def sample_plugin(self, tmp_path):
        manifest = {
            "name": "test-plugin",
            "description": "A test plugin",
            "license": "MIT",
        }
        (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        ts_src = '''
api.registerTool({
  name: 'hello_world',
  description: 'Say hello',
  parameters: Type.Object({
    name: Type.String(),
    count: Type.Optional(Type.Number()),
  }),
}, async (params) => {
  return `Hello, ${params.name}!`;
});
'''
        (tmp_path / "index.ts").write_text(ts_src, encoding="utf-8")
        return tmp_path

    def test_import_generates_package(self, sample_plugin, tmp_path):
        from src.brain.plugins import import_plugin
        output_dir = tmp_path / "output"
        dest = import_plugin(str(sample_plugin), str(output_dir))
        assert (dest / "__init__.py").is_file()
        assert (dest / "SKILL.md").is_file()

    def test_import_generates_tool_file(self, sample_plugin, tmp_path):
        from src.brain.plugins import import_plugin
        output_dir = tmp_path / "output"
        dest = import_plugin(str(sample_plugin), str(output_dir))
        assert (dest / "hello_world.py").is_file()

    def test_generated_tool_has_correct_types(self, sample_plugin, tmp_path):
        from src.brain.plugins import import_plugin
        output_dir = tmp_path / "output"
        dest = import_plugin(str(sample_plugin), str(output_dir))
        content = (dest / "hello_world.py").read_text()
        assert "str" in content
        assert "float | None" in content

    def test_no_manifest_raises(self, tmp_path):
        from src.brain.plugins import import_plugin
        with pytest.raises(FileNotFoundError, match="manifest.json"):
            import_plugin(str(tmp_path))

    def test_no_register_tool_raises(self, tmp_path):
        from src.brain.plugins import import_plugin
        manifest = {"name": "empty"}
        (tmp_path / "manifest.json").write_text(json.dumps(manifest))
        (tmp_path / "index.ts").write_text("// no tools", encoding="utf-8")
        with pytest.raises(ValueError, match="No api.registerTool"):
            import_plugin(str(tmp_path))


class TestImportedToolsPackage:
    """11.1 — src.brain.tools.imported package exists."""

    def test_package_importable(self):
        from src.brain.tools import imported
        assert imported is not None
