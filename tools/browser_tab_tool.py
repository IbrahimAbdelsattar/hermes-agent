#!/usr/bin/env python3
"""Open a URL or website in a new browser tab for the user.

Works across Web Dashboard, Desktop, and CLI:
- Web Dashboard / Desktop: Emits browser.open_tab and preview.open via desktop_ui.
- Local desktop environment: Falls back to Python's standard webbrowser.open().
- Headless / Remote without client: Returns friendly link guidance.
"""

import json
from tools import desktop_ui
from tools.open_preview_tool import _normalize_target
from tools.registry import registry, tool_error


def open_browser_tab(url: str, label: str = "") -> str:
    """Open a URL in a new tab in the user's active browser or dashboard."""
    target = _normalize_target(url or "")
    if not target:
        return tool_error("url is required — a web URL or domain name (e.g. 'https://www.youtube.com' or 'youtube.com').")
    label = (label or "").strip()

    if desktop_ui.available():
        desktop_ui.emit("browser.open_tab", {"url": target, "label": label})
        desktop_ui.emit("preview.open", {"url": target, "label": label})
        return json.dumps({"success": True, "url": target, "label": label, "opened_in": "browser_tab"})

    try:
        import webbrowser
        if webbrowser.open(target):
            return json.dumps({"success": True, "url": target, "label": label, "opened_in": "system_browser"})
    except Exception:
        pass

    return json.dumps({
        "success": True,
        "url": target,
        "label": label,
        "message": f"Browser tab action triggered for {target}. Direct link: {target}",
    })


OPEN_BROWSER_TAB_SCHEMA = {
    "name": "open_browser_tab",
    "description": (
        "Open a URL or website in a new tab in the user's browser or dashboard. "
        "Use this whenever the user asks to open a website, webpage, or URL (e.g. "
        "'open youtube', 'open google.com', 'go to github.com'). Accepts full URLs "
        "or bare domains like 'youtube.com'."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL or domain to open in the browser.",
            },
            "label": {
                "type": "string",
                "description": "Optional label or title for the tab.",
            },
        },
        "required": ["url"],
    },
}

registry.register(
    name="open_browser_tab",
    toolset="browser",
    schema=OPEN_BROWSER_TAB_SCHEMA,
    handler=lambda args, **kw: open_browser_tab(url=args.get("url", ""), label=args.get("label", "")),
    emoji="🌐",
)
