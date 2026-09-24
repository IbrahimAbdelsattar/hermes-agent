from __future__ import annotations

import os
import sys
import threading
import types

import pytest
import yaml

import tui_gateway.server as server
from agent.secret_scope import get_secret, is_multiplex_active, set_multiplex_active
from hermes_constants import get_hermes_home


@pytest.fixture
def two_voice_profiles(tmp_path, monkeypatch):
    launch = tmp_path / "launch"
    secondary = tmp_path / "profiles" / "b"
    launch.mkdir(parents=True)
    secondary.mkdir(parents=True)
    (launch / "config.yaml").write_text(
        yaml.safe_dump({"tts": {"provider": "openai", "voice": "a"}, "voice": {"record_key": "ctrl+a"}}),
        encoding="utf-8",
    )
    (secondary / "config.yaml").write_text(
        yaml.safe_dump({"tts": {"provider": "openai", "voice": "b"}, "voice": {"record_key": "ctrl+b"}}),
        encoding="utf-8",
    )
    (launch / ".env").write_text("VOICE_TEST_KEY=a-key\n", encoding="utf-8")
    (secondary / ".env").write_text("VOICE_TEST_KEY=b-key\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setenv("HERMES_VOICE", "0")
    monkeypatch.setenv("HERMES_VOICE_TTS", "0")
    monkeypatch.setattr(server, "_hermes_home", launch)

    def profile_home(name):
        if name == "b":
            return secondary
        if name in {"", "a"}:
            return None
        raise AssertionError(f"unexpected profile: {name}")

    monkeypatch.setattr(server, "_profile_home", profile_home)
    monkeypatch.setattr(server, "_voice_state_by_profile", {})
    monkeypatch.setattr(server, "_voice_active_owner", None)
    was_multiplex = is_multiplex_active()
    set_multiplex_active(True)
    try:
        yield launch, secondary
    finally:
        set_multiplex_active(was_multiplex)


def test_voice_tts_keeps_a_b_a_profile_scope_through_its_thread(two_voice_profiles, monkeypatch):
    seen = []
    completed = threading.Event()

    def fake_speak(text, stop_event=None):
        seen.append((str(get_hermes_home()), get_secret("VOICE_TEST_KEY"), server._load_cfg()["tts"]["voice"]))
        completed.set()

    import hermes_cli.voice as voice

    monkeypatch.setattr(voice, "speak_text", fake_speak)
    for profile in ("a", "b", "a"):
        completed.clear()
        response = server._methods["voice.tts"]("tts", {"text": "hello", "profile": profile})
        assert response["result"] == {"status": "speaking"}
        assert completed.wait(timeout=10)
    assert seen == [
        (str(two_voice_profiles[0]), "a-key", "a"),
        (str(two_voice_profiles[1]), "b-key", "b"),
        (str(two_voice_profiles[0]), "a-key", "a"),
    ]


def test_tts_lease_thread_keeps_the_callers_profile_scope(two_voice_profiles, monkeypatch):
    seen = []
    done = threading.Event()

    def acquire(lease):
        seen.append((str(get_hermes_home()), get_secret("VOICE_TEST_KEY"), lease))
        done.set()

    monkeypatch.setitem(
        sys.modules,
        "tools.tts_tool_lifecycle",
        types.SimpleNamespace(acquire_tts_lease=acquire, release_tts_lease=lambda _lease: None),
    )
    with server._session_profile_runtime_scope({"profile_home": str(two_voice_profiles[1])}):
        server._tts_lease_async("profile-b", True)

    assert done.wait(timeout=10)
    assert seen == [(str(two_voice_profiles[1]), "b-key", "profile-b")]


def test_contextless_fallback_speak_rebinds_the_active_owner(two_voice_profiles, monkeypatch):
    seen = []
    done = threading.Event()

    def fake_speak(text, stop_event=None):
        seen.append((str(get_hermes_home()), get_secret("VOICE_TEST_KEY")))
        done.set()

    import hermes_cli.voice as voice

    monkeypatch.setattr(voice, "speak_text", fake_speak)
    with server._session_profile_runtime_scope({"profile_home": str(two_voice_profiles[1])}):
        server._set_voice_flag("HERMES_VOICE_TTS", "tts", True)

    worker = threading.Thread(target=server._speak_text_with_barge, args=("hello",), daemon=True)
    worker.start()
    assert done.wait(timeout=10)
    worker.join(timeout=10)
    assert seen == [(str(two_voice_profiles[1]), "b-key")]


def test_named_profile_voice_flags_do_not_read_the_launch_env(two_voice_profiles, monkeypatch):
    monkeypatch.setattr(server, "_tts_lease_async", lambda lease, active: None)
    monkeypatch.setattr(server, "_tts_stream_stop", lambda user_barge=True: None)
    monkeypatch.setitem(
        sys.modules,
        "tools.voice_mode",
        types.SimpleNamespace(check_voice_requirements=lambda: {"available": True, "details": ""}),
    )
    monkeypatch.setitem(
        sys.modules,
        "tools.voice_mode_transcript",
        types.SimpleNamespace(voice_stop_hint=lambda: ""),
    )

    assert server._methods["voice.toggle"]("a-on", {"action": "on", "profile": "a"})["result"]["enabled"] is True
    b_status = server._methods["voice.toggle"]("b-status", {"action": "status", "profile": "b"})["result"]
    assert b_status["enabled"] is False
    assert b_status["record_key"] == "ctrl+b"
    assert server._methods["voice.toggle"]("b-on", {"action": "on", "profile": "b"})["result"]["enabled"] is True
    assert os.environ["HERMES_VOICE"] == "1"
    a_status = server._methods["voice.toggle"]("a-status", {"action": "status", "profile": "a"})["result"]
    assert a_status["enabled"] is True
    assert a_status["record_key"] == "ctrl+a"
    assert server._methods["voice.toggle"]("b-off", {"action": "off", "profile": "b"})["result"]["enabled"] is False
    assert os.environ["HERMES_VOICE"] == "1"
    assert server._methods["voice.toggle"]("a-status-2", {"action": "status", "profile": "a"})["result"]["enabled"] is True
