"""Tests for the open_browser_tab tool."""

import json
import pytest

from tools import desktop_ui
from tools.browser_tab_tool import open_browser_tab
from tools.registry import registry


@pytest.fixture(autouse=True)
def _reset_emitter():
    desktop_ui.set_emitter(None)
    yield
    desktop_ui.set_emitter(None)


def test_registered_in_browser_toolset():
    entry = registry.get_entry("open_browser_tab")
    assert entry is not None
    assert entry.toolset == "browser"
    assert entry.schema["name"] == "open_browser_tab"


def test_open_browser_tab_empty_url_errors():
    res = json.loads(open_browser_tab(""))
    assert "error" in res


def test_open_browser_tab_with_desktop_ui_emitter():
    emitted = []

    def mock_emitter(sid, event, payload):
        emitted.append((sid, event, payload))

    desktop_ui.set_emitter(mock_emitter)
    res = json.loads(open_browser_tab("youtube.com", label="YouTube"))
    assert res.get("success") is True
    assert res.get("opened_in") == "browser_tab"
    assert len(emitted) == 2
    events = [e[1] for e in emitted]
    assert "browser.open_tab" in events
    assert "preview.open" in events
    assert emitted[0][2]["url"] == "https://youtube.com"


def test_open_browser_tab_without_emitter(monkeypatch):
    monkeypatch.setattr("webbrowser.open", lambda url: True)
    res = json.loads(open_browser_tab("https://example.com"))
    assert res.get("success") is True
