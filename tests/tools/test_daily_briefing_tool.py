"""Tests for daily_briefing tool and toolsets integration."""

from __future__ import annotations

import pytest
from tools.daily_briefing_tool import (
    DAILY_BRIEFING_SCHEMA,
    check_daily_briefing_requirements,
    daily_briefing_handler,
)
from tools.registry import registry
from toolsets import TOOLSETS, _HERMES_CORE_TOOLS


def test_daily_briefing_tool_registered():
    entry = registry.get_entry("daily_briefing")
    assert entry is not None
    assert entry.name == "daily_briefing"
    assert entry.toolset == "web"
    assert entry.schema == DAILY_BRIEFING_SCHEMA
    assert check_daily_briefing_requirements() is True


def test_daily_briefing_toolset_membership():
    assert "daily_briefing" in _HERMES_CORE_TOOLS
    assert "daily_briefing" in TOOLSETS["web"]["tools"]
    assert "daily_briefing" in TOOLSETS
    assert "daily_briefing" in TOOLSETS["daily_briefing"]["tools"]
    assert "daily_briefing" in TOOLSETS["public_apis"]["tools"]


def test_daily_briefing_handler_currencies(monkeypatch):
    from hermes_cli import public_apis_briefing

    monkeypatch.setattr(
        public_apis_briefing,
        "fetch_currencies",
        lambda: {
            "USD_EGP": 51.66,
            "USD_SAR": 3.75,
            "USD_AED": 3.67,
            "USD_EUR": 0.87,
            "BTC_USD": 95000.0,
            "GOLD_OZ_USD": 2800.0,
            "GOLD_GRAM_24K_EGP": 4650.0,
            "updated_at": "2026-09-23 12:00 UTC",
        },
    )

    output = daily_briefing_handler({"category": "currencies"})
    assert "Live Currency & Market Rates" in output
    assert "51.66 EGP" in output
    assert "Bitcoin (BTC)" in output


def test_daily_briefing_handler_weather(monkeypatch):
    from hermes_cli import public_apis_briefing

    monkeypatch.setattr(
        public_apis_briefing,
        "fetch_weather",
        lambda city="cairo": {
            "city": "Cairo",
            "city_ar": "القاهرة",
            "temp_c": 31.5,
            "apparent_temp_c": 33.0,
            "condition_ar": "مشمس",
            "condition_en": "Clear sky",
            "humidity": 45,
            "wind_speed_kmh": 14.2,
        },
    )

    output = daily_briefing_handler({"category": "weather", "city": "cairo"})
    assert "Cairo" in output
    assert "31.5°C" in output
    assert "مشمس" in output


def test_daily_briefing_handler_channel_news(monkeypatch):
    from hermes_cli import public_apis_briefing

    monkeypatch.setattr(
        public_apis_briefing,
        "fetch_channel_news",
        lambda channel, limit=5: [
            {
                "title": "OpenAI announces GPT-5 release",
                "link": "https://example.com/gpt5",
                "source": "TechCrunch",
                "description": "Next generation AI models launched.",
            }
        ],
    )

    output = daily_briefing_handler({"category": "ai", "limit": 3})
    assert "AI" in output
    assert "OpenAI announces GPT-5 release" in output
    assert "TechCrunch" in output
