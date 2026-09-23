"""Tests for DSML and text-based tool call parsing."""

import json
from agent.dsml_parser import (
    extract_dsml_and_text_tool_calls,
    is_dsml_or_tool_call_text,
    stream_text_may_be_dsml,
    strip_dsml_tags,
)


def test_parse_user_exact_dsml_snippet():
    raw_text = """<｜｜DSML｜｜ calls>
    <｜｜DSML｜｜ invoke name="skill_view">
    <｜｜DSML｜｜ parameter name="name" string="true">google-workspace</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>
    <｜｜DSML｜｜ invoke name="terminal">
    <｜｜DSML｜｜ parameter name="command" string="true">which gws; ls -la ~/.config/gws 2>/dev/null; ls -la ~/.gws
    2>/dev/null; echo "---"; gws --version 2>&1 | head -5</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>"""

    assert is_dsml_or_tool_call_text(raw_text) is True

    calls, cleaned = extract_dsml_and_text_tool_calls(raw_text)
    assert len(calls) == 2

    # Call 1: skill_view
    assert calls[0]["function"]["name"] == "skill_view"
    args1 = json.loads(calls[0]["function"]["arguments"])
    assert args1["name"] == "google-workspace"

    # Call 2: terminal
    assert calls[1]["function"]["name"] == "terminal"
    args2 = json.loads(calls[1]["function"]["arguments"])
    assert "which gws" in args2["command"]
    assert "gws --version" in args2["command"]

    # Cleaned text should have the DSML block stripped
    assert cleaned == ""
    assert "<｜｜DSML｜｜" not in cleaned


def test_parse_dsml_with_surrounding_text():
    raw_text = """I will now inspect the Google Workspace CLI tool for you.

<｜｜DSML｜｜ calls>
    <｜｜DSML｜｜ invoke name="terminal">
    <｜｜DSML｜｜ parameter name="command" string="true">gws --help</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>

Please wait while I retrieve the command information."""

    calls, cleaned = extract_dsml_and_text_tool_calls(raw_text)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "terminal"
    args = json.loads(calls[0]["function"]["arguments"])
    assert args["command"] == "gws --help"

    assert "I will now inspect the Google Workspace CLI tool for you." in cleaned
    assert "Please wait while I retrieve the command information." in cleaned
    assert "<｜｜DSML｜｜" not in cleaned


def test_parse_dsml_ascii_pipe_variant():
    raw_text = """<||DSML|| calls>
    <||DSML|| invoke name="read_file">
    <||DSML|| parameter name="path" string="true">config.yaml</||DSML|| parameter>
    <||DSML|| parameter name="limit" string="false">100</||DSML|| parameter>
    </||DSML|| invoke>
</||DSML|| calls>"""

    calls, cleaned = extract_dsml_and_text_tool_calls(raw_text)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "read_file"
    args = json.loads(calls[0]["function"]["arguments"])
    assert args["path"] == "config.yaml"
    assert args["limit"] == 100
    assert cleaned == ""


def test_parse_standard_tool_call_tag():
    raw_text = """<tool_call>
{"name": "web_search", "arguments": {"query": "weather Cairo"}}
</tool_call>"""

    calls, cleaned = extract_dsml_and_text_tool_calls(raw_text)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "web_search"
    args = json.loads(calls[0]["function"]["arguments"])
    assert args["query"] == "weather Cairo"
    assert cleaned == ""


def test_stream_text_may_be_dsml():
    assert stream_text_may_be_dsml("<｜｜DSML｜｜") is True
    assert stream_text_may_be_dsml("  <||DSML||") is True
    assert stream_text_may_be_dsml("<tool_call>") is True
    assert stream_text_may_be_dsml("Hello world, here is the answer.") is False


def test_strip_dsml_tags():
    raw = "Hello <｜｜DSML｜｜ calls>some call</｜｜DSML｜｜ calls> World"
    assert strip_dsml_tags(raw).strip() == "Hello  World"


def test_parse_unclosed_dsml_block():
    raw = """<｜｜DSML｜｜ calls>
    <｜｜DSML｜｜ invoke name="terminal">
    <｜｜DSML｜｜ parameter name="command" string="true">ls -la</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>"""

    calls, cleaned = extract_dsml_and_text_tool_calls(raw)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "terminal"
    assert json.loads(calls[0]["function"]["arguments"])["command"] == "ls -la"
    assert "<｜｜DSML｜｜" not in cleaned
