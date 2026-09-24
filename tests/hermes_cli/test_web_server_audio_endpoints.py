"""Tests for /api/youtube and audio router endpoints."""

from __future__ import annotations

import pytest
from unittest import mock
from starlette.testclient import TestClient

from hermes_cli import web_server
import hermes_cli.web_routers.audio as audio_router


@pytest.fixture
def client(monkeypatch, _isolate_hermes_home):
    previous_auth_required = getattr(web_server.app.state, "auth_required", None)
    web_server.app.state.auth_required = False

    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    try:
        yield test_client
    finally:
        close = getattr(test_client, "close", None)
        if close is not None:
            close()
        if previous_auth_required is None:
            if hasattr(web_server.app.state, "auth_required"):
                delattr(web_server.app.state, "auth_required")
        else:
            web_server.app.state.auth_required = previous_auth_required


def test_audio_router_module_types_and_cache():
    """Verify module-level type definitions and caches initialize without NameError."""
    assert isinstance(audio_router._YOUTUBE_CACHE, dict)
    assert audio_router._YOUTUBE_CACHE_TTL == 3600.0


def test_youtube_search_missing_query(client):
    res = client.get("/api/youtube/search", params={"q": "   "})
    assert res.status_code == 400
    assert "Search query must not be empty" in res.json()["detail"]


def test_youtube_search_success_and_cache(client, monkeypatch):
    mock_helper = mock.MagicMock()
    mock_helper.search_youtube.return_value = [
        {"id": "abc12345", "title": "Test Video", "url": "https://www.youtube.com/watch?v=abc12345"}
    ]
    monkeypatch.setattr(audio_router, "_get_youtube_helper", lambda: mock_helper)
    audio_router._YOUTUBE_CACHE.clear()

    res = client.get("/api/youtube/search", params={"q": "iron man", "limit": 3})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["cached"] is False
    assert len(data["results"]) == 1
    assert data["results"][0]["id"] == "abc12345"

    # Second call should hit in-memory cache
    res2 = client.get("/api/youtube/search", params={"q": "iron man", "limit": 3})
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["ok"] is True
    assert data2["cached"] is True


def test_youtube_play_endpoint(client, monkeypatch):
    mock_helper = mock.MagicMock()
    mock_helper.search_youtube.return_value = [
        {"id": "xyz9876", "title": "Iron Man Theme", "url": "https://www.youtube.com/watch?v=xyz9876"}
    ]
    mock_helper.open_in_browser.return_value = True
    monkeypatch.setattr(audio_router, "_get_youtube_helper", lambda: mock_helper)

    res = client.post(
        "/api/youtube/play",
        json={"query": "iron man theme", "open_browser": True, "autoplay": True},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["opened"] is True
    assert data["video"]["id"] == "xyz9876"


def test_audio_speak_persona_voice_selection(client, monkeypatch, tmp_path):
    """Ensure persona determines whether male or female Edge voice is used."""
    import json
    counter = 0

    captured_calls = []

    def fake_tts(text, provider=None, voice=None, model=None):
        nonlocal counter
        counter += 1
        dummy_audio = tmp_path / f"audio_{counter}.mp3"
        dummy_audio.write_bytes(b"dummy-audio")
        captured_calls.append({"text": text, "provider": provider, "voice": voice, "model": model})
        return json.dumps({"success": True, "file_path": str(dummy_audio)})

    import tools.tts_tool as tts_module
    monkeypatch.setattr(tts_module, "text_to_speech_tool", fake_tts)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "")

    # Jarvis (male) English
    res = client.post("/api/audio/speak", json={"text": "Hello world", "persona": "jarvis"})
    assert res.status_code == 200
    assert captured_calls[-1]["voice"] == "en-US-GuyNeural"

    # Jarvis (male) Arabic
    res = client.post("/api/audio/speak", json={"text": "مرحبا بك", "persona": "jarvis"})
    assert res.status_code == 200
    assert captured_calls[-1]["voice"] == "ar-EG-ShakirNeural"

    # Gwen (female) English
    res = client.post("/api/audio/speak", json={"text": "Hello world", "persona": "gwen"})
    assert res.status_code == 200
    assert captured_calls[-1]["voice"] == "en-US-AriaNeural"

    # Gwen (female) Arabic
    res = client.post("/api/audio/speak", json={"text": "مرحبا بك", "persona": "gwen"})
    assert res.status_code == 200
    assert captured_calls[-1]["voice"] == "ar-EG-SalmaNeural"


def test_audio_speak_uses_configured_provider_without_persona_or_override(
    client, monkeypatch, tmp_path
):
    import json

    import yaml
    from hermes_constants import get_hermes_home
    import tools.tts_tool as tts_module

    (get_hermes_home() / "config.yaml").write_text(
        yaml.safe_dump({"tts": {"provider": "fish"}}), encoding="utf-8"
    )
    audio_path = tmp_path / "configured-provider.mp3"
    audio_path.write_bytes(b"configured-audio")
    captured = {}

    def fake_tts(text, provider=None, voice=None, model=None):
        captured["provider"] = provider
        if provider is None:
            provider = tts_module._get_provider(tts_module._load_tts_config())
        captured["resolved_provider"] = provider
        captured["voice"] = voice
        return json.dumps({"success": True, "file_path": str(audio_path)})

    monkeypatch.setattr(tts_module, "text_to_speech_tool", fake_tts)
    res = client.post("/api/audio/speak", json={"text": "Use my configured voice"})

    assert res.status_code == 200
    assert captured == {"provider": None, "resolved_provider": "fish", "voice": None}


def test_audio_speak_combines_all_reported_files_and_deletes_them(
    client, monkeypatch, tmp_path
):
    import base64
    import json

    import tools.tts_tool as tts_module

    audio_paths = [tmp_path / "reply.part01.mp3", tmp_path / "reply.part02.mp3"]
    audio_paths[0].write_bytes(b"first-part")
    audio_paths[1].write_bytes(b"second-part")

    def fake_tts(text, provider=None, voice=None, model=None):
        return json.dumps(
            {
                "success": True,
                "file_path": str(audio_paths[0]),
                "file_paths": [str(path) for path in audio_paths],
                "provider": "edge",
            }
        )

    monkeypatch.setattr(tts_module, "text_to_speech_tool", fake_tts)
    res = client.post(
        "/api/audio/speak", json={"text": "A long reply", "provider": "edge"}
    )

    assert res.status_code == 200
    encoded = res.json()["data_url"].split(",", 1)[1]
    assert base64.b64decode(encoded) == b"first-partsecond-part"
    assert all(not path.exists() for path in audio_paths)


