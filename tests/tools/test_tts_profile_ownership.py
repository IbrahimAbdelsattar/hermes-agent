"""Profile ownership and child-environment contracts for local TTS lifecycle code."""

from __future__ import annotations

import os
import subprocess

from hermes_constants import (
    get_process_hermes_home, hermes_home_key, reset_hermes_home_override, set_hermes_home_override,
)
from tools import tts_tool, tts_tool_delivery, tts_tool_lifecycle, tts_tool_local


def _capture_run(monkeypatch, module):
    captured = {}

    def _run(command, **kwargs):
        captured["command"] = command
        captured.update(kwargs)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(module.subprocess, "run", _run)
    return captured


def _profile(path):
    path.mkdir(parents=True, exist_ok=True)
    return set_hermes_home_override(path)


def test_kittentts_cache_is_profile_owned_a_b_a(tmp_path, monkeypatch):
    home_a = tmp_path / "profiles" / "a"
    home_b = tmp_path / "profiles" / "b"
    home_a.mkdir(parents=True)
    home_b.mkdir(parents=True)
    key_a = hermes_home_key(home_a)
    key_b = hermes_home_key(home_b)

    class _Model:
        loads = 0

        def __init__(self, name):
            type(self).loads += 1
            self.name = name

    monkeypatch.setattr(tts_tool, "_import_kittentts", lambda: _Model)
    config = {"kittentts": {"model": "shared-model"}}

    token = _profile(home_a)
    try:
        tts_tool_local._load_kittentts_model_for_config(config)
        keys_a = {key for key in tts_tool_local._kittentts_model_cache if key_a in key}
    finally:
        reset_hermes_home_override(token)
    token = _profile(home_b)
    try:
        tts_tool_local._load_kittentts_model_for_config(config)
        keys_b = {key for key in tts_tool_local._kittentts_model_cache if key_b in key}
    finally:
        reset_hermes_home_override(token)

    assert _Model.loads == 2
    assert keys_a and keys_b
    token = _profile(home_a)
    try:
        assert tts_tool_lifecycle.release_tts_provider("kittentts") == {"released": 1}
        assert not any(key in tts_tool_local._kittentts_model_cache for key in keys_a)
        assert all(key in tts_tool_local._kittentts_model_cache for key in keys_b)
        tts_tool_local._load_kittentts_model_for_config(config)
        assert _Model.loads == 3
    finally:
        reset_hermes_home_override(token)


def test_ffmpeg_child_env_is_scoped_and_scrubbed(tmp_path, monkeypatch):
    target = tmp_path / "profile-ffmpeg"
    target.mkdir()
    monkeypatch.setenv("OPENAI_API_KEY", "launch-key")
    captured = _capture_run(monkeypatch, tts_tool_delivery)
    token = _profile(target)
    try:
        tts_tool_delivery._ffmpeg_run("ffmpeg", ["-i", "input.wav"])
    finally:
        reset_hermes_home_override(token)

    env = captured["env"]
    assert env["HERMES_HOME"] == str(target)
    assert "OPENAI_API_KEY" not in env
    assert env is not os.environ
    assert get_process_hermes_home() != target


def test_local_helper_child_env_is_scoped_and_scrubbed(tmp_path, monkeypatch):
    target = tmp_path / "profile-helper"
    target.mkdir()
    monkeypatch.setenv("OPENAI_API_KEY", "launch-key")
    captured = _capture_run(monkeypatch, tts_tool_local)
    token = _profile(target)
    try:
        tts_tool_local._run_helper(["helper"], 1)
    finally:
        reset_hermes_home_override(token)

    env = captured["env"]
    assert env["HERMES_HOME"] == str(target)
    assert "OPENAI_API_KEY" not in env
    assert env is not os.environ
