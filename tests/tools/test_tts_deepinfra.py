"""Tests for the DeepInfra TTS provider.

``_generate_deepinfra_tts`` is a thin shim that resolves credentials/model
then delegates to ``_generate_openai_tts``. These two tests pin the
delegation happy path and the no-hardcoded-fallback contract; shared
infrastructure (catalog fetch + tag filter) is covered in
``tests/hermes_cli/test_api_key_providers.py``.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _isolation(monkeypatch):
    import hermes_cli.models as _models_mod
    monkeypatch.setattr(_models_mod, "_deepinfra_catalog_cache", {})
    monkeypatch.setenv("DEEPINFRA_API_KEY", "test-key")
    yield


def test_raises_when_no_model_resolvable(monkeypatch, tmp_path):
    """No-fallback contract: empty config + unreachable catalog → ValueError."""
    import urllib.request
    monkeypatch.setattr(
        urllib.request, "urlopen",
        lambda *a, **kw: (_ for _ in ()).throw(Exception("offline")),
    )
    from tools.tts_tool import _generate_deepinfra_tts
    with pytest.raises(ValueError, match="No DeepInfra TTS model available"):
        _generate_deepinfra_tts("hi", str(tmp_path / "out.mp3"), {})


def test_speed_precedence_reaches_openai_compatible_backend(tmp_path, monkeypatch):
    from tools import tts_tool

    monkeypatch.setattr(tts_tool, "_resolve_provider_key", lambda *_: "test-key")
    with patch.object(tts_tool, "_generate_openai_tts", return_value=str(tmp_path / "out.mp3")) as generate:
        tts_tool._generate_deepinfra_tts(
            "hi", str(tmp_path / "out.mp3"),
            {
                "speed": 1.5,
                "openai": {"language": "fr"},
                "deepinfra": {
                    "model": "vendor/tts", "speed": 0.75, "language": "es",
                    "instructions": "Speak brightly.",
                },
            },
        )
    assert generate.call_args.kwargs["speed"] == 0.75
    assert generate.call_args.kwargs["instructions"] == "Speak brightly."
    assert generate.call_args.kwargs["extra_body"] == {"lang_code": "es"}

    with patch.object(tts_tool, "_generate_openai_tts", return_value=str(tmp_path / "out.mp3")) as generate:
        tts_tool._generate_deepinfra_tts(
            "hi", str(tmp_path / "out.mp3"),
            {"speed": 1.25, "deepinfra": {"model": "vendor/tts", "speed": None}},
        )
    assert generate.call_args.kwargs["speed"] == 1.25


def test_requirements_follow_explicit_deepinfra_provider(monkeypatch):
    from tools import tts_tool

    monkeypatch.setattr(
        tts_tool,
        "_load_tts_config",
        lambda: {"provider": "deepinfra", "deepinfra": {}},
    )
    monkeypatch.setattr(tts_tool, "_import_openai_client", lambda: object)

    assert tts_tool.check_tts_requirements() is True


def test_unselected_cloud_credentials_do_not_expose_edge_tool(monkeypatch):
    from tools import tts_tool

    monkeypatch.setattr(tts_tool, "_load_tts_config", lambda: {})
    monkeypatch.setattr(tts_tool, "_import_edge_tts", MagicMock(side_effect=ImportError))
    monkeypatch.setenv("OPENAI_API_KEY", "unselected-key")

    assert tts_tool.check_tts_requirements() is False
