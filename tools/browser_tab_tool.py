#!/usr/bin/env python3
"""Open a URL or website in a new browser tab for the user.

Works across Web Dashboard, Desktop, and CLI:
- Web Dashboard / Desktop: Emits browser.open_tab and preview.open via desktop_ui.
- Local desktop environment: Falls back to Python's standard webbrowser.open().
- Headless / Remote without client: Returns friendly link guidance.
"""

import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

from tools import desktop_ui
from tools.open_preview_tool import _normalize_target
from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)


def _find_chrome_executable() -> Optional[str]:
    """Find the Chrome executable across Windows, macOS, and Linux."""
    for name in ("google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found

    if sys.platform == "win32":
        candidates = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("LocalAppData", r"C:\Users\Default\AppData\Local")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        ]
        for p in candidates:
            if p.is_file():
                return str(p)
    elif sys.platform == "darwin":
        candidates = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ]
        for p in candidates:
            if p.is_file():
                return str(p)

    return None


def _open_chrome_app(url: str) -> bool:
    """Launch URL in a new Chrome App mode window (--app=<url>)."""
    chrome_bin = _find_chrome_executable()
    if not chrome_bin:
        return False
    try:
        creationflags = 0
        if sys.platform == "win32":
            creationflags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen(
            [chrome_bin, f"--app={url}"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            close_fds=(sys.platform != "win32"),
        )
        return True
    except Exception as exc:
        logger.debug("Failed to launch Chrome app mode: %s", exc)
        return False


def open_browser_tab(url: str, label: str = "") -> str:
    """Open a URL in a new Chrome app window or browser tab."""
    target = _normalize_target(url or "")
    if not target:
        return tool_error("url is required — a web URL or domain name (e.g. 'https://www.youtube.com' or 'youtube.com').")
    label = (label or "").strip()

    if desktop_ui.available():
        desktop_ui.emit("browser.open_tab", {"url": target, "label": label})
        desktop_ui.emit("preview.open", {"url": target, "label": label})
        return json.dumps({"success": True, "url": target, "label": label, "opened_in": "browser_tab"})

    try:
        if _open_chrome_app(target):
            return json.dumps({"success": True, "url": target, "label": label, "opened_in": "chrome_app"})
    except Exception:
        pass

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
        "Open a URL or website in a new Chrome app window or browser tab for the user. "
        "Use this whenever the user asks to open a website, webpage, URL, or tab (e.g. "
        "'open youtube', 'open google.com', 'go to github.com', 'open new tab'). Accepts full URLs "
        "or bare domains like 'youtube.com'."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL or domain to open in a new Chrome app window or browser.",
            },
            "label": {
                "type": "string",
                "description": "Optional label or title for the tab or window.",
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
