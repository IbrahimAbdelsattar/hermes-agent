---
name: jev
description: "Use TypeSafe Jev fast decision routing and sub-second intent execution in Hermes."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [jev, typesafe, intent-routing, decisions, openrouter, voice, fast-path]
    category: autonomous-ai-agents
    related_skills: [computer-use, hermes-agent]
---

# TypeSafe Jev (Fast Intent Decision Routing)

TypeSafe Jev (`~typesafe/jev-latest` on OpenRouter Decisions API) is Hermes's built-in fast-decision, ultra-low-latency intent router and action classifier.

Jev enables Hermes to classify user requests instantly and execute direct client-side and server-side actions without waiting for a full multi-turn model response.

## Core Capabilities

Jev classifies queries into discrete intent domains:

| Intent | Description | Actions & Tools |
|---|---|---|
| `browser` | Web page navigation, opening tabs, closing tabs | `open_browser_tab`, client `window.open` |
| `computer` | OS GUI automation, desktop screenshots, background controls | `computer_use`, cua-driver |
| `research` | Deep web search, information discovery, document analysis | `web_search`, `web_extract` |
| `memory` | Long-term memory retrieval and personal preference storage | `memory` |
| `reminder` | Scheduling alarms, alerts, and recurring background jobs | `cronjob_manage` |
| `tools` | Enabling, checking, or configuring MCP and system tools | `manage_connections`, `hermes tools` |
| `skills` | Invoking, viewing, or managing specialized Hermes skills | `skill_view`, `skill_manage` |
| `voice` | Voice mode toggles, male/female voice switches, TTS tuning | Voice bar controls, `text_to_speech` |
| `chat` | Conversational questions and general assistance | Default LLM reasoning |

## How Hermes Uses Jev

### 1. Web Dashboard & Voice Controls (Fast Path)
The Hermes Web UI integrates Jev into the voice and command pipeline:
- **Jev Toggle**: Located on the voice control toolbar (`Jev: On / Off`).
- **Endpoint**: `/api/jarvis/jev-route` evaluates incoming queries using OpenRouter Decisions API with strict fallback matching.
- **Client Fast Path**: When Jev classifies a request as `browser` (e.g., "open youtube", "open google"), the web client immediately resolves the target URL and opens it in a new tab via `window.open(url, "_blank")`.

### 2. Browser Tab Opening in Remote & Headless Environments
When running on remote or headless servers (such as a cloud VM or Docker container without a physical display):
- Hermes uses the `open_browser_tab` tool to send a `browser.open_tab` event over the WebSocket events feed (`/api/pub` -> `/api/events`).
- The user's active browser dashboard receives the event and opens the URL on the user's local machine.
- This bridges headless server execution with the user's interactive browser!

### 3. Computer Use vs. Browser Operations
- **`computer_use`**: Used when an interactive desktop session ($DISPLAY / X11 / Wayland / Windows desktop) is available to automate native OS GUI windows.
- **`open_browser_tab` & `browser_navigate`**: Used for web tasks, allowing both automated headless browser scraping and live tab display on the user's client machine.

## OpenRouter Configuration

Hermes can query Jev directly via OpenRouter:
- **Model**: `~typesafe/jev-latest` or `typesafe/jev-latest`
- **Decisions Endpoint**: `https://openrouter.ai/api/v1/decisions`
- **Authorization**: Configured via `OPENROUTER_API_KEY` in `~/.hermes/.env`.
