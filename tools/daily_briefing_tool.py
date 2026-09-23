"""Daily intelligence briefing tool for Hermes Agent.

Exposes real-time currency exchange rates (USD to EGP, SAR, AED, EUR, Gold, Bitcoin),
live meteorological weather (Open-Meteo), and 4-channel live news feeds (AI, Economics,
Gaza & Palestine, Startups & Fundraising) directly to the agent tool loop.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)

DAILY_BRIEFING_SCHEMA = {
    "name": "daily_briefing",
    "description": (
        "Retrieve live daily intelligence briefing data: real-time currency exchange rates "
        "(USD to EGP, EUR, SAR, AED, Gold, Bitcoin), live meteorological weather (Cairo and global cities), "
        "and live categorized news feeds across: 'ai' (Artificial Intelligence & LLMs), 'economics' "
        "(global economics & markets), 'gaza' (Palestine & Gaza geopolitical updates), and 'fundraising' "
        "(startups, VC & venture capital). "
        "Use this whenever the user asks for news, currency rates (e.g. dollar price to EGP/SAR), "
        "weather, or an intelligence briefing."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "city": {
                "type": "string",
                "description": "City preset for weather: 'cairo', 'alexandria', 'riyadh', 'dubai', 'london', 'newyork'. Default: 'cairo'.",
                "default": "cairo",
            },
            "category": {
                "type": "string",
                "enum": ["all", "currencies", "weather", "ai", "economics", "gaza", "fundraising"],
                "description": "Specific briefing section to retrieve, or 'all' for the full comprehensive executive digest.",
                "default": "all",
            },
            "limit": {
                "type": "integer",
                "description": "Max news articles per channel (default: 5, max: 15).",
                "default": 5,
            },
        },
        "required": [],
    },
}


def daily_briefing_handler(args: Dict[str, Any], **kwargs) -> str:
    """Execute live briefing query and return formatted summary for the model."""
    city = str(args.get("city", "cairo") or "cairo").strip().lower()
    category = str(args.get("category", "all") or "all").strip().lower()
    limit = min(max(int(args.get("limit", 5)), 1), 15)

    try:
        from hermes_cli.public_apis_briefing import (
            fetch_currencies,
            fetch_weather,
            fetch_channel_news,
            get_full_briefing,
            generate_executive_digest,
        )

        if category == "currencies":
            cur = fetch_currencies()
            lines = [
                "### Live Currency & Market Rates:",
                f"- USD / EGP: {cur.get('USD_EGP')} EGP",
                f"- USD / SAR: {cur.get('USD_SAR')} SAR",
                f"- USD / AED: {cur.get('USD_AED')} AED",
                f"- USD / EUR: {cur.get('USD_EUR')} EUR",
                f"- Bitcoin (BTC): ${cur.get('BTC_USD', 0):,.2f}",
                f"- Gold (XAU): ${cur.get('GOLD_OZ_USD', 0):,.2f}/oz (~{cur.get('GOLD_GRAM_24K_EGP', 0):,.1f} EGP/g 24K)",
                f"- Updated: {cur.get('updated_at')}",
            ]
            return "\n".join(lines)

        elif category == "weather":
            w = fetch_weather(city)
            lines = [
                f"### Live Weather for {w.get('city')} ({w.get('city_ar')}):",
                f"- Temperature: {w.get('temp_c')}°C (Feels like: {w.get('apparent_temp_c')}°C)",
                f"- Condition: {w.get('condition_ar')} / {w.get('condition_en')}",
                f"- Humidity: {w.get('humidity')}%",
                f"- Wind Speed: {w.get('wind_speed_kmh')} km/h",
            ]
            return "\n".join(lines)

        elif category in ("ai", "economics", "gaza", "fundraising"):
            articles = fetch_channel_news(category, limit=limit)
            titles = [f"### Live News Feed - {category.upper()}:"]
            for i, a in enumerate(articles, 1):
                titles.append(f"{i}. **{a['title']}** ({a['source']})")
                if a.get("description"):
                    titles.append(f"   {a['description']}")
                titles.append(f"   Link: {a['link']}")
            return "\n".join(titles)

        else:
            # category == 'all'
            data = get_full_briefing(city=city, force_refresh=False)
            exec_summary = generate_executive_digest(data)

            # Also append top news links
            lines = [exec_summary, "", "### Top Stories by Category:"]
            for ch in ["ai", "economics", "gaza", "fundraising"]:
                lines.append(f"\n**{ch.upper()}:**")
                for a in (data.get("news", {}).get(ch, []) or [])[:3]:
                    lines.append(f"- {a['title']} ({a['source']}) - {a['link']}")

            return "\n".join(lines)

    except Exception as exc:
        logger.exception("daily_briefing error: %s", exc)
        return tool_error(f"Failed fetching daily briefing: {exc}")


def check_daily_briefing_requirements() -> bool:
    """Daily briefing relies on built-in HTTP fetchers and is always available."""
    return True


registry.register(
    name="daily_briefing",
    toolset="web",
    schema=DAILY_BRIEFING_SCHEMA,
    check_fn=check_daily_briefing_requirements,
    handler=daily_briefing_handler,
    emoji="📰",
)
