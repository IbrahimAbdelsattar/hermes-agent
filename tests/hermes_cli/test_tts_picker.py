"""Tests for the TTS plugin picker surface in hermes_cli/tools_config.py (issue #30398).

Covers ``_plugin_tts_providers()`` and the ``_visible_providers()``
integration that injects plugin rows into the Text-to-Speech category.

Mirrors the structure of existing image_gen / browser picker tests.
"""

from __future__ import annotations

import pytest

from agent import tts_registry
from agent.tts_provider import TTSProvider
from hermes_cli import tools_config


class _FakeTTSProvider(TTSProvider):
    def __init__(self, name: str, schema: dict | None = None):
        self._name = name
        self._schema = schema

    @property
    def name(self) -> str:
        return self._name

    def synthesize(self, text, output_path, **kw):
        return output_path

    def get_setup_schema(self):
        if self._schema is not None:
            return self._schema
        return super().get_setup_schema()


@pytest.fixture(autouse=True)
def _reset_registry():
    tts_registry._reset_for_tests()
    yield
    tts_registry._reset_for_tests()


class TestPluginTTSProviders:
    """``_plugin_tts_providers()`` returns picker-row dicts."""




    def test_skips_providers_with_no_name(self):
        """Defense in depth: a provider with no .name attribute is skipped
        rather than crashing the picker."""

        class _NoName:
            display_name = "Bogus"
            def get_setup_schema(self):
                return {"name": "Bogus"}

        tts_registry._providers["bogus"] = _NoName()  # type: ignore[assignment]
        try:
            rows = tools_config._plugin_tts_providers()
            # Provider has no .name so the picker filters it out
            assert all(r.get("tts_plugin_name") != "bogus" for r in rows)
        finally:
            tts_registry._providers.pop("bogus", None)  # type: ignore[arg-type]


    def test_minimal_schema_uses_display_name(self):
        """A provider with no setup_schema override gets a row built from
        ``display_name`` and ``name`` only."""
        tts_registry.register_provider(_FakeTTSProvider(name="minimal"))
        rows = tools_config._plugin_tts_providers()
        assert len(rows) == 1
        assert rows[0]["name"] == "Minimal"  # display_name default
        assert rows[0]["tts_provider"] == "minimal"
        assert rows[0]["env_vars"] == []



class TestVisibleProvidersInjectsTTSPlugins:
    """``_visible_providers()`` injects plugin rows into the Text-to-Speech
    category alongside the hardcoded built-in rows."""

    def test_tts_category_includes_plugin_rows(self):
        tts_registry.register_provider(_FakeTTSProvider(name="cartesia"))

        tts_cat = tools_config.TOOL_CATEGORIES["tts"]
        visible = tools_config._visible_providers(tts_cat, config={})

        names = [row.get("name") for row in visible]
        # Hardcoded rows (sample — check at least one is present)
        assert "Microsoft Edge TTS" in names
        # Plugin row injected at the end
        assert "Cartesia" in names

        # Plugin row has tts_provider key for write-path compat
        plugin_rows = [r for r in visible if r.get("tts_plugin_name")]
        assert len(plugin_rows) == 1
        assert plugin_rows[0]["tts_provider"] == "cartesia"

    def test_other_categories_unaffected_by_tts_plugins(self):
        """Registering a TTS plugin must not leak into the Image Generation
        or Browser pickers."""
        tts_registry.register_provider(_FakeTTSProvider(name="cartesia"))

        img_cat = tools_config.TOOL_CATEGORIES["image_gen"]
        visible = tools_config._visible_providers(img_cat, config={})
        names = [row.get("name") for row in visible]
        assert "Cartesia" not in names


class TestBuiltinTtsSurface:
    def test_every_runtime_builtin_is_offered_by_setup_tools_and_web(self):
        from hermes_cli.setup_tts import _TTS_PROVIDER_CHOICES
        from hermes_cli.web_server_config import CONFIG_SCHEMA
        from tools.tts_tool import BUILTIN_TTS_PROVIDERS

        setup_names = {name for name, _label in _TTS_PROVIDER_CHOICES}
        tools_names = {
            row.get("tts_provider") for row in tools_config.TOOL_CATEGORIES["tts"]["providers"]
            if row.get("tts_provider")
        }
        web_names = set(CONFIG_SCHEMA["tts.provider"]["options"])

        assert BUILTIN_TTS_PROVIDERS <= setup_names
        assert BUILTIN_TTS_PROVIDERS <= tools_names
        assert BUILTIN_TTS_PROVIDERS <= web_names

    def test_every_nonempty_tts_default_leaf_is_in_the_web_schema(self):
        from hermes_cli.config_defaults import DEFAULT_CONFIG
        from hermes_cli.web_server_config import CONFIG_SCHEMA

        def leaves(value, prefix="tts"):
            paths = set()
            for key, child in value.items():
                path = f"{prefix}.{key}"
                if isinstance(child, dict) and child:
                    paths.update(leaves(child, path))
                elif not isinstance(child, dict):
                    paths.add(path)
            return paths

        assert leaves(DEFAULT_CONFIG["tts"]) <= set(CONFIG_SCHEMA)

    @pytest.mark.parametrize(
        "key",
        [
            "tts.max_text_length", "tts.openai.max_text_length", "tts.openrouter.max_text_length",
            "tts.elevenlabs.speed", "tts.openai.speed", "tts.xai.speed", "tts.deepinfra.speed",
        ],
    )
    def test_nullable_numeric_tts_options_are_number_fields(self, key):
        from hermes_cli.web_server_config import CONFIG_SCHEMA

        assert CONFIG_SCHEMA[key]["type"] == "number"

