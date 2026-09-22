"""Tests for Public APIs router and data manager."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hermes_cli.public_apis_data import (
    FALLBACK_APIS,
    get_categories,
    get_stats,
    parse_public_apis_markdown,
    search_catalog,
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / ".hermes"))
    from hermes_cli import web_server

    test_client = TestClient(web_server.app)
    test_client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN
    return test_client


def test_markdown_parser():
    sample_md = """
### Animals
| API | Description | Auth | HTTPS | CORS |
|:---|:---|:---|:---|:---|
| [Axolotl](https://theaxolotlapi.netlify.app/) | Collection of axolotl pictures | No | Yes | No |
| [Cat Facts](https://catfact.ninja/) | Random cat facts | `apiKey` | Yes | Yes |

### Weather
| API | Description | Auth | HTTPS | CORS |
|:---|:---|:---|:---|:---|
| [Open-Meteo](https://open-meteo.com/) | Weather forecasts | No | Yes | Yes |
"""
    items = parse_public_apis_markdown(sample_md)
    assert len(items) == 3
    assert items[0]["name"] == "Axolotl"
    assert items[0]["category"] == "Animals"
    assert items[0]["auth"] == "No"
    assert items[0]["https"] is True
    assert items[0]["cors"] == "no"

    assert items[1]["name"] == "Cat Facts"
    assert items[1]["auth"] == "apiKey"

    assert items[2]["name"] == "Open-Meteo"
    assert items[2]["category"] == "Weather"


def test_public_apis_list_endpoint(client):
    res = client.get("/api/public-apis?limit=10")
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "total" in data
    assert len(data["items"]) <= 10
    assert data["total"] > 0


def test_public_apis_search_query(client):
    res = client.get("/api/public-apis?q=weather&limit=10")
    assert res.status_code == 200
    data = res.json()
    for item in data["items"]:
        text = (item["name"] + " " + item["description"] + " " + item["category"]).lower()
        assert "weather" in text


def test_public_apis_category_filter(client):
    res = client.get("/api/public-apis?category=Animals&limit=10")
    assert res.status_code == 200
    data = res.json()
    for item in data["items"]:
        assert item["category"].lower() == "animals"


def test_public_apis_auth_filter(client):
    res = client.get("/api/public-apis?auth=free&limit=10")
    assert res.status_code == 200
    data = res.json()
    for item in data["items"]:
        assert item["auth"].lower() in ("no", "none", "")


def test_public_apis_categories_endpoint(client):
    res = client.get("/api/public-apis/categories")
    assert res.status_code == 200
    data = res.json()
    assert "categories" in data
    assert len(data["categories"]) > 0
    first = data["categories"][0]
    assert "category" in first
    assert "count" in first
    assert first["count"] > 0


def test_public_apis_stats_endpoint(client):
    res = client.get("/api/public-apis/stats")
    assert res.status_code == 200
    data = res.json()
    assert data["total_apis"] > 0
    assert data["total_categories"] > 0
    assert "https_percentage" in data
    assert "repo_url" in data


def test_public_apis_random_endpoint(client):
    res = client.get("/api/public-apis/random?count=3")
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) == 3


def test_public_apis_test_endpoint_validation(client):
    # Invalid scheme
    res = client.post("/api/public-apis/test", json={"url": "ftp://example.com"})
    assert res.status_code == 400

    # Valid scheme (even if mocked or non-existent)
    res = client.post("/api/public-apis/test", json={"url": "https://httpbin.org/get"})
    assert res.status_code == 200
    data = res.json()
    assert "alive" in data
    assert "latency_ms" in data
