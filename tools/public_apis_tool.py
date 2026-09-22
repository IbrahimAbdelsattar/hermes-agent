"""Public APIs search tool for Hermes Agent.

Provides discovery and search over 1,890+ curated public APIs from:
https://github.com/public-apis/public-apis.git
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)

PUBLIC_APIS_SCHEMA = {
    "name": "public_apis_search",
    "description": (
        "Search and discover over 1,890+ curated public APIs from the public-apis repository "
        "(https://github.com/public-apis/public-apis.git). Filter by keyword, category "
        "(e.g., Weather, Animals, Cryptocurrency, Development, Machine Learning, Music, Security, Geocoding, Science & Math), "
        "or authentication requirement (free/no auth, apiKey, OAuth). "
        "Use this whenever you need to find public endpoints, datasets, or APIs to build integrations, answers, or apps."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Keywords to search across API titles and descriptions (e.g. 'weather forecast', 'bitcoin price', 'cat facts', 'geocoding', 'nasa').",
            },
            "category": {
                "type": "string",
                "description": "Optional category name (e.g., Animals, Cryptocurrency, Currency Exchange, Development, Finance, Geocoding, Machine Learning, Music, News, Science & Math, Security, Test Data, Weather).",
            },
            "auth": {
                "type": "string",
                "enum": ["free", "apiKey", "OAuth", "all"],
                "description": "Filter by authentication requirement: 'free' (no auth needed), 'apiKey', 'OAuth', or 'all'.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of APIs to return (default: 10, max: 30).",
                "default": 10,
            },
        },
        "required": [],
    },
}


def public_apis_search_handler(args: Dict[str, Any], **kwargs) -> str:
    """Execute public APIs search and format results for model consumption."""
    query = args.get("query")
    category = args.get("category")
    auth = args.get("auth")
    limit = min(max(int(args.get("limit", 10)), 1), 30)

    try:
        from hermes_cli.public_apis_data import search_catalog, get_stats
        items, total = search_catalog(
            query=query,
            category=category,
            auth=auth,
            limit=limit,
            offset=0,
        )

        if not items:
            crit = []
            if query:
                crit.append(f"query='{query}'")
            if category:
                crit.append(f"category='{category}'")
            if auth and auth != "all":
                crit.append(f"auth='{auth}'")
            crit_str = " with " + ", ".join(crit) if crit else ""
            return f"No public APIs found{crit_str}. Try broader search keywords or run without category/auth filters."

        output_lines = [
            f"Found {total} public APIs from public-apis (showing top {len(items)}):",
            "",
        ]

        for i, item in enumerate(items, 1):
            auth_display = item.get("auth", "No") or "No"
            https_display = "Yes" if item.get("https") else "No"
            cors_display = item.get("cors", "unknown")
            output_lines.append(f"{i}. **{item['name']}** [{item['category']}]")
            output_lines.append(f"   - Description: {item['description']}")
            output_lines.append(f"   - URL / Docs: {item['url']}")
            output_lines.append(f"   - Auth: {auth_display} | HTTPS: {https_display} | CORS: {cors_display}")
            output_lines.append("")

        return "\n".join(output_lines).strip()

    except Exception as exc:
        logger.exception("public_apis_search error: %s", exc)
        return tool_error(f"Failed searching public APIs: {exc}")


def check_public_apis_requirements() -> bool:
    """Public APIs catalog is always available (local fallback + cached)."""
    return True


registry.register(
    name="public_apis_search",
    toolset="web",
    schema=PUBLIC_APIS_SCHEMA,
    check_fn=check_public_apis_requirements,
    handler=public_apis_search_handler,
    emoji="🌐",
)
