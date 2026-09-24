"""OpenRouter TTS provider E2E: config propagation, model/voice selection, MIME and errors.

Real imports through the full ``text_to_speech_tool`` chain against a temp
``HERMES_HOME`` (``config.yaml`` selects the provider/model, ``.env`` carries
``OPENROUTER_API_KEY``); only the external HTTP boundary (``requests.post``)
is faked. No paid request is ever sent.
"""

import json
from unittest.mock import patch

import yaml


class _FakeORResponse:
    """Minimal ``requests``-shaped response driving the bounded streaming readers."""

    def __init__(self, *, status_code=200, content_type="audio/mpeg", body=b""):
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}
        self._body = body

    def iter_content(self, chunk_size=None):
        yield self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"HTTP {self.status_code}")

    def close(self):
        pass


def _write_home(home, config):
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(yaml.safe_dump(config))
    (home / ".env").write_text("OPENROUTER_API_KEY=or-home-secret\n")


def _isolate(monkeypatch, tmp_path):
    """Temp HERMES_HOME with no ambient key leakage; returns the home path."""
    home = tmp_path / ".hermes"
    monkeypatch.setenv("HERMES_HOME", str(home))
    for var in ("OPENROUTER_API_KEY", "HERMES_SESSION_PLATFORM"):
        monkeypatch.delenv(var, raising=False)
    return home


def test_flux_default_voice_and_mp3_mime_through_full_chain(tmp_path, monkeypatch):
    """Default Flux model/voice from a temp home reach the wire; MP3 bytes land on disk."""
    from tools import tts_tool

    home = _isolate(monkeypatch, tmp_path)
    _write_home(home, {"tts": {"provider": "openrouter"}})

    captured = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers", {})
        captured["payload"] = kwargs.get("json", {})
        return _FakeORResponse(body=b"ID3\x04\x00\x00" + b"\x00" * 64)

    assert tts_tool.check_tts_requirements() is True
    with patch("requests.post", side_effect=fake_post):
        result = json.loads(tts_tool.text_to_speech_tool("Hello Jarvis"))

    assert captured["url"] == "https://openrouter.ai/api/v1/audio/speech"
    assert captured["headers"]["Authorization"] == "Bearer or-home-secret"
    assert captured["payload"]["model"] == "deepgram/flux-tts:free"
    assert captured["payload"]["input"] == "Hello Jarvis"
    assert captured["payload"]["voice"] == "flux-alexis-en"
    assert captured["payload"]["response_format"] == "mp3"

    assert result["success"] is True
    assert result["provider"] == "openrouter"
    with open(result["file_path"], "rb") as fh:
        assert fh.read() == b"ID3\x04\x00\x00" + b"\x00" * 64


def test_speed_precedence_reaches_wire(tmp_path, monkeypatch):
    from tools import tts_tool

    home = _isolate(monkeypatch, tmp_path)
    _write_home(home, {
        "tts": {
            "provider": "openrouter",
            "speed": 1.5,
            "openrouter": {"speed": 0.75},
        },
    })
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(kwargs["json"])
        return _FakeORResponse(body=b"ID3" + b"\x00" * 32)

    with patch("requests.post", side_effect=fake_post):
        result = json.loads(tts_tool.text_to_speech_tool("Hello"))

    assert result["success"] is True
    assert captured["speed"] == 0.75


def test_fish_model_voice_and_json_error_reporting(tmp_path, monkeypatch):
    """Fish model with an explicit voice override; a JSON error surfaces as a named failure."""
    from tools import tts_tool
    from tools.tts_tool_openrouter import DEFAULT_FISH_AUDIO_VOICE

    assert DEFAULT_FISH_AUDIO_VOICE  # contract: Fish default comes from the official docs example

    home = _isolate(monkeypatch, tmp_path)
    _write_home(home, {"tts": {"provider": "openrouter",
                               "openrouter": {"model": "fish-audio/s2.1-pro-free:free"}}})

    captured = {}

    def fake_post(url, **kwargs):
        captured["payload"] = kwargs.get("json", {})
        return _FakeORResponse(
            status_code=400, content_type="application/json",
            body=json.dumps({"error": {"code": 400, "message": "voice not found"}}).encode())

    with patch("requests.post", side_effect=fake_post):
        # Fish model without an explicit voice resolves to the Fish default voice.
        result = json.loads(tts_tool.text_to_speech_tool("مرحبا", voice=None))

    assert captured["payload"]["model"] == "fish-audio/s2.1-pro-free:free"
    assert captured["payload"]["voice"] == DEFAULT_FISH_AUDIO_VOICE
    assert result["success"] is False
    assert "fish-audio/s2.1-pro-free:free" in result["error"]
    assert "voice not found" in result["error"]

    # An explicit per-call voice wins over the model default.
    def fake_ok(url, **kwargs):
        captured["payload"] = kwargs.get("json", {})
        return _FakeORResponse(body=b"ID3" + b"\x00" * 32)

    with patch("requests.post", side_effect=fake_ok):
        ok = json.loads(tts_tool.text_to_speech_tool("Hello", voice="flux-bruce-en"))
    assert captured["payload"]["voice"] == "flux-bruce-en"
    assert ok["success"] is True
