"""FastAPI web router for Public APIs explorer and catalog manager."""

from __future__ import annotations

import asyncio
import logging
import time
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from hermes_cli.public_apis_data import (
    get_categories,
    get_random,
    get_stats,
    search_catalog,
    sync_catalog,
)

_log = logging.getLogger("hermes_cli.web_server")
router = APIRouter(prefix="/api/public-apis", tags=["public-apis"])


class TestApiRequest(BaseModel):
    url: str = Field(..., description="Target URL of the public API or documentation to ping")


@router.get("")
async def query_public_apis(
    q: Optional[str] = Query(None, description="Search term across name, description, and category"),
    category: Optional[str] = Query(None, description="Filter by category name"),
    auth: Optional[str] = Query(None, description="Filter by auth type: free, apiKey, OAuth, all"),
    https: Optional[bool] = Query(None, description="Filter by HTTPS support"),
    cors: Optional[str] = Query(None, description="Filter by CORS support: yes, no, unknown, all"),
    limit: int = Query(50, ge=1, le=250, description="Page size"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> Dict[str, Any]:
    """Search and filter the curated catalog of 1,890+ public APIs."""
    items, total = await asyncio.to_thread(
        search_catalog,
        query=q,
        category=category,
        auth=auth,
        https=https,
        cors=cors,
        limit=limit,
        offset=offset,
    )
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/categories")
async def list_categories() -> Dict[str, Any]:
    """List all categories with API counts."""
    categories = await asyncio.to_thread(get_categories)
    return {"categories": categories, "total": len(categories)}


@router.get("/stats")
async def catalog_stats() -> Dict[str, Any]:
    """Get aggregate statistics for the public APIs catalog."""
    stats = await asyncio.to_thread(get_stats)
    return stats


@router.get("/random")
async def random_public_apis(
    count: int = Query(1, ge=1, le=20, description="Number of random APIs to return"),
    category: Optional[str] = Query(None, description="Optional category filter"),
) -> Dict[str, Any]:
    """Pick random APIs from the catalog for discovery or inspiration."""
    items = await asyncio.to_thread(get_random, count=count, category=category)
    return {"items": items}


@router.post("/sync")
async def sync_catalog_endpoint() -> Dict[str, Any]:
    """Trigger a refresh from upstream https://github.com/public-apis/public-apis.git."""
    try:
        result = await asyncio.to_thread(sync_catalog)
        return result
    except Exception as exc:
        _log.exception("Failed syncing public APIs catalog: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed syncing from upstream repository: {exc}")


@router.post("/test")
async def test_api_endpoint(req: TestApiRequest) -> Dict[str, Any]:
    """Test connectivity to an API endpoint."""
    url = req.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL scheme. Must start with http:// or https://")

    def _ping():
        t0 = time.time()
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=4.0) as resp:
                elapsed_ms = int((time.time() - t0) * 1000)
                return {
                    "url": url,
                    "alive": True,
                    "status_code": resp.status,
                    "latency_ms": elapsed_ms,
                    "content_type": resp.headers.get("Content-Type", ""),
                }
        except urllib.error.HTTPError as he:
            elapsed_ms = int((time.time() - t0) * 1000)
            # HTTP error response like 401 or 403 or 404 still indicates the server is alive and responding
            return {
                "url": url,
                "alive": True,
                "status_code": he.code,
                "latency_ms": elapsed_ms,
                "note": f"Server responded with HTTP {he.code}",
            }
        except Exception as exc:
            elapsed_ms = int((time.time() - t0) * 1000)
            return {
                "url": url,
                "alive": False,
                "status_code": 0,
                "latency_ms": elapsed_ms,
                "error": str(exc),
            }

    return await asyncio.to_thread(_ping)


@router.get("/briefing")
async def daily_briefing_endpoint(
    city: str = Query("cairo", description="City preset for weather: cairo, alexandria, riyadh, dubai, london, newyork"),
    refresh: bool = Query(False, description="Bypass cache and fetch fresh live data"),
) -> Dict[str, Any]:
    """Return consolidated live intelligence bulletin (currencies, weather, 4-channel news)."""
    from hermes_cli.public_apis_briefing import get_full_briefing
    briefing = await asyncio.to_thread(get_full_briefing, city=city, force_refresh=refresh)
    return briefing


@router.get("/briefing/news")
async def briefing_news_endpoint(
    channel: str = Query("ai", description="Channel: ai, economics, gaza, fundraising"),
    limit: int = Query(15, ge=1, le=50, description="Max articles to fetch"),
) -> Dict[str, Any]:
    """Fetch live news articles for a specific intelligence channel."""
    from hermes_cli.public_apis_briefing import fetch_channel_news
    articles = await asyncio.to_thread(fetch_channel_news, channel=channel, limit=limit)
    return {"channel": channel, "articles": articles, "count": len(articles)}


@router.post("/briefing/summarize")
async def briefing_summarize_endpoint(
    city: str = Query("cairo", description="City preset for weather"),
) -> Dict[str, Any]:
    """Generate an executive intelligence summary ready for display or Jarvis TTS."""
    from hermes_cli.public_apis_briefing import get_full_briefing, generate_executive_digest
    briefing = await asyncio.to_thread(get_full_briefing, city=city, force_refresh=False)
    summary_text = generate_executive_digest(briefing)
    return {
        "summary": summary_text,
        "currencies": briefing.get("currencies", {}),
        "weather": briefing.get("weather", {}),
    }

