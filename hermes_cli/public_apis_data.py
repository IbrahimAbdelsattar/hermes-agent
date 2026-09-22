"""Public APIs catalog data manager for Hermes Agent.

Parses and caches the curated public-apis catalog from:
https://github.com/public-apis/public-apis.git
Provides search, category filtering, stats, random picking, and sync capabilities.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from hermes_constants import get_hermes_home

_log = logging.getLogger("hermes_cli.public_apis")

PUBLIC_APIS_REPO = "https://github.com/public-apis/public-apis.git"
PUBLIC_APIS_RAW_URL = "https://raw.githubusercontent.com/public-apis/public-apis/master/README.md"
CACHE_EXPIRY_SECONDS = 86400 * 7  # 7 days

# In-memory memoized catalog
_CATALOG_CACHE: Optional[List[Dict[str, Any]]] = None
_CATALOG_LOADED_AT: float = 0.0

# Curated bootstrap dataset ensuring instant zero-network offline availability
FALLBACK_APIS: List[Dict[str, Any]] = [
    {
        "name": "Cat Facts",
        "url": "https://catfact.ninja/",
        "description": "Daily random cat facts and trivia",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Animals"
    },
    {
        "name": "Dog API",
        "url": "https://dog.ceo/dog-api/",
        "description": "Open source database of dog pictures and breeds",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Animals"
    },
    {
        "name": "CoinGecko",
        "url": "https://www.coingecko.com/api",
        "description": "Cryptocurrency prices, market caps, and exchange volumes",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Cryptocurrency"
    },
    {
        "name": "Binance",
        "url": "https://binance-docs.github.io/apidocs/spot/en/",
        "description": "Cryptocurrency exchange spot trading and ticker metrics",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Cryptocurrency"
    },
    {
        "name": "ExchangeRate-API",
        "url": "https://www.exchangerate-api.com",
        "description": "Free foreign exchange currency conversion and live rates",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Currency Exchange"
    },
    {
        "name": "Frankfurter",
        "url": "https://www.frankfurter.app/docs/",
        "description": "Track foreign exchange reference rates published by the ECB",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Currency Exchange"
    },
    {
        "name": "Open-Meteo",
        "url": "https://open-meteo.com/",
        "description": "Free open-source weather forecast and historical API without API key",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Weather"
    },
    {
        "name": "OpenWeatherMap",
        "url": "https://openweathermap.org/api",
        "description": "Current weather, 5-day forecasts, air pollution, and weather maps",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Weather"
    },
    {
        "name": "GitHub REST API",
        "url": "https://docs.github.com/en/rest",
        "description": "Interact with GitHub repositories, issues, pull requests, and users",
        "auth": "OAuth",
        "https": True,
        "cors": "yes",
        "category": "Development"
    },
    {
        "name": "GitLab API",
        "url": "https://docs.gitlab.com/ee/api/",
        "description": "Automate GitLab projects, pipelines, issues, and deployments",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Development"
    },
    {
        "name": "Hugging Face Hub",
        "url": "https://huggingface.co/docs/hub/api",
        "description": "Models, datasets, inference endpoints, and Spaces repository APIs",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Machine Learning"
    },
    {
        "name": "OpenAI API",
        "url": "https://platform.openai.com/docs/api-reference",
        "description": "State of the art generative language, vision, speech, and embeddings models",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Machine Learning"
    },
    {
        "name": "Spotify Web API",
        "url": "https://developer.spotify.com/documentation/web-api/",
        "description": "Search tracks, artists, albums, playlists, and control playback",
        "auth": "OAuth",
        "https": True,
        "cors": "yes",
        "category": "Music"
    },
    {
        "name": "MusicBrainz",
        "url": "https://musicbrainz.org/doc/MusicBrainz_API",
        "description": "Open music encyclopedia collecting music metadata and releases",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Music"
    },
    {
        "name": "NewsAPI",
        "url": "https://newsapi.org/",
        "description": "Locate live breaking news articles and headlines across global publishers",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "News"
    },
    {
        "name": "NASA Open APIs",
        "url": "https://api.nasa.gov/",
        "description": "Astronomy picture of the day, Mars rover photos, NEOs, and earth imagery",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Science & Math"
    },
    {
        "name": "Where The ISS At",
        "url": "https://wheretheiss.at/w/developer",
        "description": "Real-time coordinates, speed, and visibility of the International Space Station",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Science & Math"
    },
    {
        "name": "IPinfo",
        "url": "https://ipinfo.io/developers",
        "description": "Fast and accurate IP geolocation, ASN, and hosting detection",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Geocoding"
    },
    {
        "name": "Nominatim OpenStreetMap",
        "url": "https://nominatim.org/release-docs/latest/api/Overview/",
        "description": "Search OSM data by name and address (geocoding) and reverse lookup",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Geocoding"
    },
    {
        "name": "HaveIBeenPwned",
        "url": "https://haveibeenpwned.com/API/v3",
        "description": "Check if an email or password has been compromised in data breaches",
        "auth": "apiKey",
        "https": True,
        "cors": "yes",
        "category": "Security"
    },
    {
        "name": "JSONPlaceholder",
        "url": "https://jsonplaceholder.typicode.com/",
        "description": "Fake REST API for testing and prototyping with posts, users, comments",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Test Data"
    },
    {
        "name": "ReqRes",
        "url": "https://reqres.in/",
        "description": "A hosted REST-API ready to respond to AJAX requests for testing",
        "auth": "No",
        "https": True,
        "cors": "yes",
        "category": "Test Data"
    },
]


def _get_cache_path() -> Path:
    """Return the filesystem path for public APIs cache."""
    cache_dir = get_hermes_home() / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / "public_apis.json"


def parse_public_apis_markdown(content: str) -> List[Dict[str, Any]]:
    """Parse public-apis README.md table format into clean structured dicts."""
    entry_re = re.compile(
        r"^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|\s*([^|]*)\s*\|"
    )
    current_category = None
    items: List[Dict[str, Any]] = []

    for line in content.splitlines():
        line = line.strip()
        if line.startswith("### "):
            current_category = line[4:].strip()
            # Clean up anchors or emojis if present
            current_category = re.sub(r"<[^>]+>", "", current_category).strip()
        elif current_category and line.startswith("|") and "[" in line:
            m = entry_re.match(line)
            if m:
                name, url, desc, auth, https_str, cors_str = [x.strip() for x in m.groups()]
                clean_auth = auth.replace("`", "").strip() or "No"
                is_https = https_str.replace("`", "").strip().lower() == "yes"
                cors_val = cors_str.replace("`", "").strip().lower() or "unknown"
                if not cors_val or "http" in cors_val or "[" in cors_val:
                    cors_val = "yes" if "yes" in cors_val else ("no" if "no" in cors_val else "unknown")

                items.append({
                    "name": name,
                    "url": url,
                    "description": desc,
                    "auth": clean_auth,
                    "https": is_https,
                    "cors": cors_val,
                    "category": current_category,
                })

    return items


def fetch_remote_catalog(timeout_seconds: float = 8.0) -> List[Dict[str, Any]]:
    """Fetch the latest README from upstream GitHub and parse it."""
    req = urllib.request.Request(
        PUBLIC_APIS_RAW_URL,
        headers={"User-Agent": "Hermes-Agent-Public-APIs-Client/1.0"}
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
        content = resp.read().decode("utf-8", errors="replace")
    parsed = parse_public_apis_markdown(content)
    if not parsed:
        raise ValueError("Parsed empty list from remote markdown")
    return parsed


def load_cached_catalog() -> Optional[List[Dict[str, Any]]]:
    """Load the cached catalog from disk if it exists."""
    path = _get_cache_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list) and len(data) > 0:
            return data
    except Exception as exc:
        _log.warning("Could not read public_apis cache: %s", exc)
    return None


def save_cached_catalog(apis: List[Dict[str, Any]]) -> None:
    """Save the catalog to disk."""
    path = _get_cache_path()
    try:
        path.write_text(json.dumps(apis, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        _log.warning("Failed writing public_apis cache: %s", exc)


def get_catalog(force_refresh: bool = False) -> List[Dict[str, Any]]:
    """Get the active public APIs catalog with tiered resolution:

    1. In-memory memoized cache
    2. Local file cache (valid within 7 days)
    3. Remote fetch from GitHub
    4. Bundled fallback dataset
    """
    global _CATALOG_CACHE, _CATALOG_LOADED_AT
    now = time.time()

    if not force_refresh and _CATALOG_CACHE is not None and (now - _CATALOG_LOADED_AT < 3600):
        return _CATALOG_CACHE

    if not force_refresh:
        disk_cached = load_cached_catalog()
        if disk_cached:
            _CATALOG_CACHE = disk_cached
            _CATALOG_LOADED_AT = now
            return disk_cached

    # Fetch fresh from GitHub
    try:
        remote_data = fetch_remote_catalog()
        save_cached_catalog(remote_data)
        _CATALOG_CACHE = remote_data
        _CATALOG_LOADED_AT = now
        return remote_data
    except Exception as err:
        _log.warning("Failed fetching remote public APIs catalog: %s. Using local fallback.", err)

    disk_cached = load_cached_catalog()
    if disk_cached:
        _CATALOG_CACHE = disk_cached
        _CATALOG_LOADED_AT = now
        return disk_cached

    _CATALOG_CACHE = list(FALLBACK_APIS)
    _CATALOG_LOADED_AT = now
    return _CATALOG_CACHE


def sync_catalog() -> Dict[str, Any]:
    """Force sync catalog from GitHub and return execution stats."""
    t0 = time.time()
    fresh = fetch_remote_catalog(timeout_seconds=12.0)
    save_cached_catalog(fresh)
    global _CATALOG_CACHE, _CATALOG_LOADED_AT
    _CATALOG_CACHE = fresh
    _CATALOG_LOADED_AT = time.time()
    elapsed = round(time.time() - t0, 3)

    categories = {api["category"] for api in fresh}
    return {
        "status": "success",
        "total_apis": len(fresh),
        "total_categories": len(categories),
        "elapsed_seconds": elapsed,
        "source": PUBLIC_APIS_REPO,
        "synced_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
    }


def search_catalog(
    query: Optional[str] = None,
    category: Optional[str] = None,
    auth: Optional[str] = None,
    https: Optional[bool] = None,
    cors: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[List[Dict[str, Any]], int]:
    """Query and filter the catalog with case-insensitive search and criteria."""
    apis = get_catalog()
    filtered: List[Dict[str, Any]] = []

    q_clean = query.strip().lower() if query else None
    cat_clean = category.strip().lower() if category else None
    auth_clean = auth.strip().lower() if auth else None
    cors_clean = cors.strip().lower() if cors else None

    for api in apis:
        if cat_clean and cat_clean != "all":
            if api["category"].lower() != cat_clean:
                continue

        if auth_clean and auth_clean != "all":
            api_auth = api["auth"].lower()
            if auth_clean in ("no", "none", "free"):
                if api_auth not in ("no", "none", ""):
                    continue
            elif auth_clean == "apikey":
                if "apikey" not in api_auth:
                    continue
            elif auth_clean == "oauth":
                if "oauth" not in api_auth:
                    continue
            else:
                if auth_clean not in api_auth:
                    continue

        if https is not None:
            if api["https"] != https:
                continue

        if cors_clean and cors_clean != "all":
            if api["cors"] != cors_clean:
                continue

        if q_clean:
            matches_q = (
                q_clean in api["name"].lower()
                or q_clean in api["description"].lower()
                or q_clean in api["category"].lower()
            )
            if not matches_q:
                continue

        filtered.append(api)

    total = len(filtered)
    paginated = filtered[offset : offset + limit] if limit > 0 else filtered
    return paginated, total


def get_categories() -> List[Dict[str, Any]]:
    """Return all categories with API counts sorted alphabetically."""
    apis = get_catalog()
    counts: Dict[str, int] = {}
    for api in apis:
        cat = api["category"]
        counts[cat] = counts.get(cat, 0) + 1

    sorted_cats = sorted(counts.items(), key=lambda x: x[0].lower())
    return [{"category": k, "count": v} for k, v in sorted_cats]


def get_stats() -> Dict[str, Any]:
    """Return high-level catalog statistics."""
    apis = get_catalog()
    total = len(apis)
    categories = len({api["category"] for api in apis})
    https_count = sum(1 for api in apis if api.get("https"))
    no_auth_count = sum(1 for api in apis if api.get("auth", "").lower() in ("no", "none", ""))
    apikey_count = sum(1 for api in apis if "apikey" in api.get("auth", "").lower())
    oauth_count = sum(1 for api in apis if "oauth" in api.get("auth", "").lower())
    cors_yes_count = sum(1 for api in apis if api.get("cors") == "yes")

    cache_path = _get_cache_path()
    last_synced = None
    if cache_path.exists():
        last_synced = time.strftime(
            "%Y-%m-%d %H:%M:%S UTC", time.gmtime(cache_path.stat().st_mtime)
        )

    return {
        "total_apis": total,
        "total_categories": categories,
        "https_count": https_count,
        "https_percentage": round((https_count / total * 100) if total else 0, 1),
        "no_auth_count": no_auth_count,
        "apikey_count": apikey_count,
        "oauth_count": oauth_count,
        "cors_yes_count": cors_yes_count,
        "last_synced": last_synced,
        "repo_url": PUBLIC_APIS_REPO,
    }


def get_random(count: int = 1, category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Pick random APIs from the catalog."""
    import random
    apis = get_catalog()
    if category and category.lower() != "all":
        apis = [a for a in apis if a["category"].lower() == category.lower()]
    if not apis:
        return []
    sample_size = min(count, len(apis))
    return random.sample(apis, sample_size)
