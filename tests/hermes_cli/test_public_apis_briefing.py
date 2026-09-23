"""Tests for live intelligence news bulletin and public APIs briefing."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hermes_cli.public_apis_briefing import (
    CITY_PRESETS,
    FALLBACK_RATES,
    fetch_channel_news,
    fetch_currencies,
    fetch_weather,
    generate_executive_digest,
    get_full_briefing,
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    from hermes_cli import web_server

    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    return test_client


def test_fetch_currencies_fallback():
    rates = fetch_currencies()
    assert "USD_EGP" in rates
    assert "USD_SAR" in rates
    assert "USD_EUR" in rates
    assert rates["USD_EGP"] > 0
    assert rates["USD_SAR"] > 0


def test_fetch_weather_presets():
    assert "cairo" in CITY_PRESETS
    weather = fetch_weather("cairo")
    assert "temp_c" in weather
    assert "city" in weather
    assert weather["city"] == "Cairo"
    assert "humidity" in weather


def test_fetch_channel_news_fallback():
    for channel in ["ai", "economics", "gaza", "fundraising"]:
        articles = fetch_channel_news(channel, limit=3)
        assert isinstance(articles, list)
        assert len(articles) > 0
        assert "title" in articles[0]
        assert "source" in articles[0]


def test_generate_executive_digest():
    sample_briefing = {
        "currencies": {"USD_EGP": 51.65, "USD_SAR": 3.75, "BTC_USD": 85000, "GOLD_OZ_USD": 4300},
        "weather": {"city": "Cairo", "city_ar": "القاهرة", "temp_c": 31.0, "condition_ar": "صافي"},
        "news": {
            "ai": [{"title": "Major AI Model Released"}],
            "economics": [{"title": "Global Inflation Cools"}],
            "gaza": [{"title": "Developments in Gaza"}],
            "fundraising": [{"title": "Startup Raises Series A"}],
        },
    }
    digest = generate_executive_digest(sample_briefing)
    assert "51.65" in digest
    assert "القاهرة" in digest
    assert "Major AI Model Released" in digest


def test_briefing_api_endpoints(client):
    res = client.get("/api/public-apis/briefing?city=cairo")
    assert res.status_code == 200
    data = res.json()
    assert "currencies" in data
    assert "weather" in data
    assert "news" in data
    assert "ai" in data["news"]
    assert "gaza" in data["news"]

    news_res = client.get("/api/public-apis/briefing/news?channel=ai&limit=5")
    assert news_res.status_code == 200
    news_data = news_res.json()
    assert news_data["channel"] == "ai"
    assert "articles" in news_data

    sum_res = client.post("/api/public-apis/briefing/summarize?city=cairo")
    assert sum_res.status_code == 200
    sum_data = sum_res.json()
    assert "summary" in sum_data
