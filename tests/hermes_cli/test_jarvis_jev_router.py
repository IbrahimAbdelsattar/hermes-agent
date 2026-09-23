"""Contract and behavioral tests for the Jarvis Jev decision router."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    from hermes_cli import web_server

    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    return test_client


def test_jarvis_jev_status_fallback_when_no_keys(client, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    r = client.get("/api/jarvis/jev-status")
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is True
    assert data["provider"] == "fallback"
    assert data["model"] == "bilingual-heuristic"
    assert data["active_key_source"] is None


def test_jarvis_jev_status_typesafe_key(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts_test_key_12345")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    r = client.get("/api/jarvis/jev-status")
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is True
    assert data["provider"] == "typesafe"
    assert data["active_key_source"] == "TYPESAFE_API_KEY"


def test_jarvis_jev_status_openrouter_key(client, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key-67890")

    r = client.get("/api/jarvis/jev-status")
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is True
    assert data["provider"] == "openrouter"
    assert data["active_key_source"] == "OPENROUTER_API_KEY"


def test_jarvis_jev_status_resolve_provider_secret(client, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with patch(
        "hermes_cli.web_routers.jarvis_jev.resolve_provider_secret",
        return_value="sk-or-resolved-secret",
    ):
        r = client.get("/api/jarvis/jev-status")
        assert r.status_code == 200
        data = r.json()
        assert data["enabled"] is True
        assert data["provider"] == "openrouter"
        assert data["active_key_source"] == "OPENROUTER_API_KEY"


def test_jarvis_jev_route_music_arabic(client):
    payload = {"text": "شغل عمرو دياب من فضلك", "language": "arabic_egyptian"}
    r = client.post("/api/jarvis/jev-route", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["route"] == "music"
    assert data["action"] == "play"
    assert "عمرو دياب" in data["target"]
    assert data["bypass_llm"] is True
    assert data["confidence"] >= 0.85
    assert data["latency_ms"] >= 0


def test_jarvis_jev_route_music_english(client):
    payload = {"text": "Jarvis, please play Iron Man soundtrack", "language": "english"}
    r = client.post("/api/jarvis/jev-route", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["route"] == "music"
    assert data["action"] == "play"
    assert "Iron Man soundtrack" in data["target"]
    assert data["bypass_llm"] is True


def test_jarvis_jev_route_music_pause_resume_skip(client):
    for phrase, expected_action in [
        ("وقف المزيكا يا جارفيس", "pause"),
        ("pause the music please", "pause"),
        ("كمل الأغنية", "resume"),
        ("resume playback", "resume"),
        ("هات اللي بعدها", "next"),
        ("skip to next song", "next"),
    ]:
        r = client.post("/api/jarvis/jev-route", json={"text": phrase})
        assert r.status_code == 200
        data = r.json()
        assert data["route"] == "music"
        assert data["action"] == expected_action
        assert data["bypass_llm"] is True


def test_jarvis_jev_route_telemetry_weather(client):
    payload = {"text": "الجو في القاهرة عامل ايه النهاردة؟", "language": "arabic_egyptian"}
    r = client.post("/api/jarvis/jev-route", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["route"] == "telemetry"
    assert data["action"] == "weather"
    assert data["bypass_llm"] is True


def test_jarvis_jev_route_telemetry_exchange(client):
    payload = {"text": "سعر الدولار كام مقابل الجنيه؟", "language": "arabic_egyptian"}
    r = client.post("/api/jarvis/jev-route", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["route"] == "telemetry"
    assert data["action"] == "exchange"
    assert data["bypass_llm"] is True


def test_jarvis_jev_route_standby(client):
    payload = {"text": "Standby Jarvis", "language": "english"}
    r = client.post("/api/jarvis/jev-route", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["route"] == "standby"
    assert data["action"] == "sleep"
    assert data["bypass_llm"] is True


def test_jarvis_jev_route_llm_query(client):
    payload = {"text": "Explain quantum computing algorithms in detail", "language": "english"}
    r = client.post("/api/jarvis/jev-route", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["route"] == "llm"
    assert data["bypass_llm"] is False


def test_jarvis_jev_remote_provider_mock(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts_mock_key")

    mock_response = {
        "answers": {
            "is_music": {"noul": 0.96},
            "is_telemetry": {"noul": 0.02},
            "is_standby": {"noul": 0.01},
            "is_task": {"noul": 0.01},
        }
    }

    with patch("hermes_cli.web_routers.jarvis_jev._call_remote_jev_sync", return_value=mock_response):
        r = client.post("/api/jarvis/jev-route", json={"text": "شغل موسيقى هادية"})
        assert r.status_code == 200
        data = r.json()
        assert data["provider"] == "typesafe"
        assert data["route"] == "music"
        assert data["confidence"] == 0.96
        assert data["bypass_llm"] is True
