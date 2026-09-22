"""Tests for public_apis_search tool and toolsets integration."""

from __future__ import annotations

import pytest
from tools.public_apis_tool import (
    PUBLIC_APIS_SCHEMA,
    check_public_apis_requirements,
    public_apis_search_handler,
)
from tools.registry import registry
from toolsets import TOOLSETS, _HERMES_CORE_TOOLS


def test_public_apis_tool_registered():
    entry = registry.get_entry("public_apis_search")
    assert entry is not None
    assert entry.name == "public_apis_search"
    assert entry.toolset == "web"
    assert entry.schema == PUBLIC_APIS_SCHEMA
    assert check_public_apis_requirements() is True


def test_public_apis_toolset_membership():
    assert "public_apis_search" in _HERMES_CORE_TOOLS
    assert "public_apis_search" in TOOLSETS["web"]["tools"]
    assert "public_apis" in TOOLSETS
    assert "public_apis_search" in TOOLSETS["public_apis"]["tools"]


def test_public_apis_search_handler_results():
    output = public_apis_search_handler({"query": "weather", "limit": 3})
    assert "Found" in output
    assert "public APIs" in output
    assert "Description:" in output
    assert "URL / Docs:" in output
    assert "Auth:" in output


def test_public_apis_search_handler_category():
    output = public_apis_search_handler({"category": "Animals", "limit": 2})
    assert "Found" in output
    assert "Animals" in output


def test_public_apis_search_handler_auth_free():
    output = public_apis_search_handler({"auth": "free", "limit": 2})
    assert "Found" in output
    assert "Auth: No" in output or "Auth: None" in output or "Auth: " in output


def test_public_apis_search_handler_not_found():
    output = public_apis_search_handler({"query": "xyznonexistent987qwerty"})
    assert "No public APIs found" in output
    assert "Try broader search" in output
