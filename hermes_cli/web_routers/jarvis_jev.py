"""TypeSafe AI Jev decision router for Jarvis Assistant.

Provides sub-150ms intent classification and route evaluation using TypeSafe AI's
Jev "System One" decision model (via direct TypeSafe API or OpenRouter Decisions API)
with automatic fallback to bilingual Egyptian Arabic and English heuristics.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter
from pydantic import BaseModel, Field

from hermes_cli.web_deps import late

_log = logging.getLogger("hermes_cli.web_server")
router = APIRouter()

# Late-bound config/env readers to respect active profile scope and avoid stale imports
load_env = late("load_env", "hermes_cli.config")

TYPESAFE_DECISIONS_URL = "https://api.typesafe.ai/v1/decisions"
OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
OPENROUTER_JEV_MODEL = "~typesafe/jev-latest"
JEV_TIMEOUT_SECONDS = 1.5


class JevRouteRequest(BaseModel):
    text: str = Field(..., description="User input text or transcribed voice utterance")
    language: Optional[str] = Field("arabic_egyptian", description="Language mode: arabic_egyptian or english")
    persona: Optional[str] = Field("jarvis", description="Active voice persona: jarvis or gwen")


class JevRouteDecision(BaseModel):
    route: str = Field(..., description="Classified route: music | telemetry | task | standby | llm")
    action: Optional[str] = Field(None, description="Specific action: play | pause | resume | next | prev | weather | exchange | crypto | gold | iss | sleep | query")
    target: Optional[str] = Field(None, description="Extracted parameter such as track name, city, or coin symbol")
    confidence: float = Field(..., description="Calibrated confidence score between 0.0 and 1.0")
    latency_ms: float = Field(..., description="End-to-end routing latency in milliseconds")
    provider: str = Field(..., description="Resolution provider: typesafe | openrouter | fallback")
    spoken_confirmation: str = Field(..., description="Immediate spoken confirmation in the user's dialect")
    bypass_llm: bool = Field(..., description="Whether to execute client-side immediately and bypass the main LLM")


class JevStatusResponse(BaseModel):
    enabled: bool
    provider: str
    model: str
    active_key_source: Optional[str]


def _get_api_credentials() -> Tuple[Optional[str], Optional[str]]:
    """Resolve TYPESAFE_API_KEY and OPENROUTER_API_KEY from profile .env or environment."""
    env_dict: Dict[str, str] = {}
    try:
        env_fn = load_env
        if callable(env_fn):
            env_dict = env_fn() or {}
    except Exception as exc:
        _log.debug("Failed reading profile .env for Jev keys: %s", exc)

    typesafe_key = env_dict.get("TYPESAFE_API_KEY") or os.environ.get("TYPESAFE_API_KEY")
    openrouter_key = env_dict.get("OPENROUTER_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    return (typesafe_key.strip() if typesafe_key else None,
            openrouter_key.strip() if openrouter_key else None)


# ---------------------------------------------------------------------------
# Bilingual Heuristic Fallback (Egyptian Arabic + English)
# ---------------------------------------------------------------------------

_STANDBY_PATTERNS = [
    re.compile(r"\b(?:standby\s*jarvis|go\s*to\s*sleep|sleep\s*mode|power\s*down|enter\s*standby|standby|goodnight\s*jarvis)\b", re.I),
    re.compile(r"(?:نام|انام|ادخل\s*وضع\s*الاستعداد|وضع\s*الاستعداد|تصبح\s*على\s*خير|اقفل\s*يا\s*جارفيس|اسكت\s*يا\s*جارفيس)", re.I),
]

_MUSIC_PAUSE_PATTERNS = [
    re.compile(r"^(?:وقف|وقفي|وقفلي|اقفل|اقفلي|اسكت|كفاية|stop|pause)\s*(?:الموسيقى|الميوزك|الميوزيك|المزيكا|الاغنية|الأغنية|الأغاني|الاغاني|music|song|the music|playback)?$", re.I),
    re.compile(r"\b(?:pause\s*(?:the\s*)?music|stop\s*(?:the\s*)?music|pause\s*song|stop\s*song|pause\s*playback|وقف\s*المزيكا)\b", re.I),
]

_MUSIC_RESUME_PATTERNS = [
    re.compile(r"^(?:كمل|كمّل|شغل تاني|استمر|resume|unpause)\s*(?:الموسيقى|الميوزك|المزيكا|الاغنية|الأغنية|music|song|playback)?$", re.I),
    re.compile(r"\b(?:resume\s*(?:the\s*)?music|continue\s*playing|unpause|resume\s*playback)\b", re.I),
]

_MUSIC_SKIP_PATTERNS = [
    re.compile(r"^(?:اللي بعدها|الأغنية اللي بعدها|الاغنية اللي بعدها|هات اللي بعدها|next|skip|next song|next track)$", re.I),
    re.compile(r"\b(?:skip\s*(?:to\s*)?(?:the\s*)?(?:next\s*)?(?:song|track)|next\s*song|next\s*track|skip\s*track)\b", re.I),
]

_MUSIC_PLAY_PATTERNS = [
    re.compile(r"^(?:شغل|شغلي|شغللي|شغللنا|عايز اسمع|عايز أسمع|عاوز اسمع|عاوز أسمع|نفسي اسمع|سمعني|افتح|play|start)\s+(.+)$", re.I),
    re.compile(r"\b(?:play\s+song|play\s+track|play\s+music|play)\s+(.+)$", re.I),
]

_TELEMETRY_WEATHER_PATTERNS = [
    re.compile(r"(?:weather|temperature|forecast|rain|hot|cold|degrees)", re.I),
    re.compile(r"(?:الجو|الطقس|درجة\s*الحرارة|الجو\s*عامل\s*ايه|حر|برد|مطر)", re.I),
]

_TELEMETRY_EXCHANGE_PATTERNS = [
    re.compile(r"(?:dollar|usd|egp|exchange\s*rate|currency|pound)", re.I),
    re.compile(r"(?:سعر\s*الدولار|الدولار\s*بكام|سعر\s*الصرف|الجنيه\s*المصري|العملة)", re.I),
]

_TELEMETRY_CRYPTO_PATTERNS = [
    re.compile(r"(?:bitcoin|btc|ethereum|eth|solana|crypto|market\s*price)", re.I),
    re.compile(r"(?:سعر\s*البيتكوين|بيتكوين|إيثريوم|كريبتو)", re.I),
]

_TELEMETRY_GOLD_PATTERNS = [
    re.compile(r"(?:gold\s*price|gold|ounce\s*of\s*gold)", re.I),
    re.compile(r"(?:سعر\s*الذهب|الذهب\s*بكام|جرام\s*الذهب|عيار\s*21)", re.I),
]

_TELEMETRY_ISS_PATTERNS = [
    re.compile(r"(?:iss|space\s*station|international\s*space\s*station)", re.I),
    re.compile(r"(?:محطة\s*الفضاء\s*الدولية|مكان\s*المحطة\s*الفضائية)", re.I),
]


def _clean_input(raw: str) -> str:
    t = raw.strip()
    # Strip conversational prefixes, wake words, and trailing polite phrases iteratively
    prev = ""
    while prev != t:
        prev = t
        t = re.sub(r"^(?:hey|hi|hello|ok|okay|please|can you|could you|would you|i want you to)\s+", "", t, flags=re.I)
        t = re.sub(r"^(?:يا\s*)?(?:جارفيس|جوين|jarvis|gwen|bot|sentinel)\s*[,،:\s-]*", "", t, flags=re.I)
        t = re.sub(r"^(?:من فضلك|لو سمحت|بالله عليك|ممكن|ياريت|بقولك|عاوزك|عايزك|اسمع|يلا)\s+", "", t, flags=re.I)
        t = re.sub(r"[,،:\s-]*(?:يا\s*)?(?:جارفيس|جوين|jarvis|gwen|bot|sentinel)[.!?]*$", "", t, flags=re.I)
        t = re.sub(r"[,،:\s-]*(?:من فضلك|لو سمحت|بالله عليك|please)[.!?]*$", "", t, flags=re.I)
        t = t.strip()
    return t


def _heuristic_classify(text: str, is_arabic: bool) -> Tuple[str, Optional[str], Optional[str], float, str, bool]:
    """Fallback classifier when Jev API is offline or unconfigured."""
    cleaned = _clean_input(text)

    # 1. Standby
    for p in _STANDBY_PATTERNS:
        if p.search(cleaned):
            spoken = "تصبح على خير، وضعت النظام في وضع الاستعداد." if is_arabic else "Entering standby mode now, Sir."
            return ("standby", "sleep", None, 0.98, spoken, True)

    # 2. Music Controls
    for p in _MUSIC_PAUSE_PATTERNS:
        if p.search(cleaned):
            spoken = "تم إيقاف تشغيل الموسيقى." if is_arabic else "Music paused, Sir."
            return ("music", "pause", None, 0.95, spoken, True)

    for p in _MUSIC_RESUME_PATTERNS:
        if p.search(cleaned):
            spoken = "جاري استئناف التشغيل." if is_arabic else "Resuming playback now."
            return ("music", "resume", None, 0.95, spoken, True)

    for p in _MUSIC_SKIP_PATTERNS:
        if p.search(cleaned):
            spoken = "تم الانتقال للمقطع التالي." if is_arabic else "Skipping to the next track."
            return ("music", "next", None, 0.95, spoken, True)

    for p in _MUSIC_PLAY_PATTERNS:
        m = p.search(cleaned)
        if m:
            query = m.group(1).strip()
            # Clean trailing fillers
            query = re.sub(r"\s+(?:من\s+اليوتيوب|على\s+اليوتيوب|from\s+youtube|on\s+youtube)$", "", query, flags=re.I).strip()
            spoken = f"شغلتلك {query} حالا." if is_arabic else f"Playing {query} right away, Sir."
            return ("music", "play", query, 0.94, spoken, True)

    # 3. Live Telemetry Feeds
    for p in _TELEMETRY_WEATHER_PATTERNS:
        if p.search(cleaned):
            spoken = "جاري استدعاء تقرير الطقس المباشر." if is_arabic else "Fetching current weather telemetry now."
            return ("telemetry", "weather", None, 0.92, spoken, True)

    for p in _TELEMETRY_EXCHANGE_PATTERNS:
        if p.search(cleaned):
            spoken = "جاري مراجعة سعر صرف الدولار والجنيه." if is_arabic else "Checking latest USD/EGP exchange rates."
            return ("telemetry", "exchange", None, 0.92, spoken, True)

    for p in _TELEMETRY_CRYPTO_PATTERNS:
        if p.search(cleaned):
            spoken = "جاري استعراض أسعار العملات الرقمية." if is_arabic else "Pulling real-time crypto prices."
            return ("telemetry", "crypto", None, 0.90, spoken, True)

    for p in _TELEMETRY_GOLD_PATTERNS:
        if p.search(cleaned):
            spoken = "جاري التحقق من سعر الذهب الحالي." if is_arabic else "Checking gold prices on the world exchange."
            return ("telemetry", "gold", None, 0.90, spoken, True)

    for p in _TELEMETRY_ISS_PATTERNS:
        if p.search(cleaned):
            spoken = "جاري تتبع إحداثيات محطة الفضاء الدولية." if is_arabic else "Tracking International Space Station orbital telemetry."
            return ("telemetry", "iss", None, 0.92, spoken, True)

    # 4. Complex request requiring Hermes AIAgent
    spoken = "جاري المعالجة بواسطة هيرمس..." if is_arabic else "Processing with Hermes reasoning core..."
    return ("llm", "query", None, 0.40, spoken, False)


# ---------------------------------------------------------------------------
# Remote Jev Decision Invoker (TypeSafe AI / OpenRouter Decisions)
# ---------------------------------------------------------------------------

def _build_jev_payload(text: str, is_arabic: bool, model: str) -> Dict[str, Any]:
    state = (
        f"User query in Jarvis voice interface (language mode: {'Egyptian Arabic' if is_arabic else 'English'}): \"{text}\"\n"
        "Determine the user's intent. Routes:\n"
        "- music: play, pause, resume, skip audio/songs or YouTube music\n"
        "- telemetry: real-time status of weather, currency exchange, cryptocurrency, gold, or ISS space station\n"
        "- standby: sleep, power down, or standby voice mode\n"
        "- task: executive task creation, updates, or backlog actions\n"
        "- llm: general questions, coding, research, multi-step problem solving, or complex terminal tools"
    )

    questions = {
        "is_music": {
            "type": "noul",
            "instructions": (
                "The user utterance asks to play, pause, resume, skip, or search for music, a song, or an audio track. "
                "Examples: 'شغل عمرو دياب', 'play iron man music', 'وقف المزيكا', 'next song'."
            ),
        },
        "is_telemetry": {
            "type": "noul",
            "instructions": (
                "The user utterance asks for live public telemetry data: weather in Cairo/anywhere, USD/EGP currency exchange, "
                "Bitcoin/Crypto prices, gold prices, or ISS location. Examples: 'الجو عامل ايه', 'what is the weather', 'سعر الدولار كام'."
            ),
        },
        "is_standby": {
            "type": "noul",
            "instructions": (
                "The user utterance asks Jarvis to sleep, go to standby, shut down, or stop listening. "
                "Examples: 'standby jarvis', 'نام', 'ادخل وضع الاستعداد'."
            ),
        },
        "is_task": {
            "type": "noul",
            "instructions": (
                "The user utterance asks to create, complete, or check executive tasks (SupplyMind, C-SAT, etc.). "
                "Examples: 'سجل مهمة جديدة', 'add task to backlog'."
            ),
        },
    }

    return {
        "model": model,
        "state": state,
        "questions": questions,
    }


def _call_remote_jev_sync(url: str, key: str, payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/NousResearch/hermes-agent",
            "X-Title": "hermes jarvis jev router",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def evaluate_jev_intent(text: str, language: str = "arabic_egyptian") -> JevRouteDecision:
    """Evaluate intent with TypeSafe Jev model, falling back cleanly on timeout or error."""
    start_time = time.monotonic()
    is_arabic = (language == "arabic_egyptian" or any("\u0600" <= c <= "\u06FF" for c in text))
    typesafe_key, openrouter_key = _get_api_credentials()

    provider = "fallback"
    route = "llm"
    action: Optional[str] = "query"
    target: Optional[str] = None
    confidence = 0.5
    spoken_confirmation = ""
    bypass_llm = False

    # Attempt remote Jev call if credentials exist
    if typesafe_key or openrouter_key:
        is_typesafe = bool(typesafe_key)
        target_url = TYPESAFE_DECISIONS_URL if is_typesafe else OPENROUTER_DECISIONS_URL
        target_key = typesafe_key if is_typesafe else (openrouter_key or "")
        target_model = "typesafe/jev-latest" if is_typesafe else OPENROUTER_JEV_MODEL
        payload = _build_jev_payload(text, is_arabic, target_model)

        loop = asyncio.get_running_loop()
        try:
            resp = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: _call_remote_jev_sync(target_url, target_key, payload, JEV_TIMEOUT_SECONDS)),
                timeout=JEV_TIMEOUT_SECONDS + 0.2,
            )
            answers = resp.get("answers") or {}
            def get_score(k: str) -> float:
                ans = answers.get(k)
                if isinstance(ans, dict) and isinstance(ans.get("noul"), (int, float)):
                    return float(ans["noul"])
                return 0.0

            m_score = get_score("is_music")
            t_score = get_score("is_telemetry")
            s_score = get_score("is_standby")
            k_score = get_score("is_task")

            top_score = max(m_score, t_score, s_score, k_score)
            provider = "typesafe" if is_typesafe else "openrouter"

            if top_score >= 0.85:
                if top_score == m_score:
                    # Parse specific music action and target
                    h_route, h_action, h_target, _, h_spoken, _ = _heuristic_classify(text, is_arabic)
                    route = "music"
                    action = h_action or "play"
                    target = h_target
                    confidence = m_score
                    spoken_confirmation = h_spoken
                    bypass_llm = True
                elif top_score == s_score:
                    route = "standby"
                    action = "sleep"
                    confidence = s_score
                    spoken_confirmation = "تصبح على خير، تم الانتقال لوضع الاستعداد." if is_arabic else "Entering standby mode now, Sir."
                    bypass_llm = True
                elif top_score == t_score:
                    h_route, h_action, h_target, _, h_spoken, _ = _heuristic_classify(text, is_arabic)
                    route = "telemetry"
                    action = h_action or "weather"
                    confidence = t_score
                    spoken_confirmation = h_spoken
                    bypass_llm = True
                elif top_score == k_score:
                    route = "task"
                    action = "create"
                    confidence = k_score
                    spoken_confirmation = "جاري تدوين المهمة في سجل المهام." if is_arabic else "Recording task in executive backlog."
                    bypass_llm = False  # Task mutations can benefit from LLM / tool pipeline
            else:
                route = "llm"
                action = "query"
                confidence = 1.0 - top_score
                spoken_confirmation = "جاري التفكير..." if is_arabic else "Processing with Hermes reasoning core..."
                bypass_llm = False

        except Exception as exc:
            _log.debug("Remote Jev evaluation bypassed (%s), using local bilingual heuristic", exc)
            provider = "fallback"

    # If provider is still fallback (either no credentials or remote error/timeout)
    if provider == "fallback":
        route, action, target, confidence, spoken_confirmation, bypass_llm = _heuristic_classify(text, is_arabic)

    latency_ms = (time.monotonic() - start_time) * 1000.0

    return JevRouteDecision(
        route=route,
        action=action,
        target=target,
        confidence=round(confidence, 3),
        latency_ms=round(latency_ms, 1),
        provider=provider,
        spoken_confirmation=spoken_confirmation,
        bypass_llm=bypass_llm,
    )


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/jarvis/jev-route", response_model=JevRouteDecision)
async def route_jarvis_intent(req: JevRouteRequest):
    """Route a voice or text utterance through TypeSafe Jev for fast-path triage."""
    return await evaluate_jev_intent(req.text, req.language or "arabic_egyptian")


@router.get("/api/jarvis/jev-status", response_model=JevStatusResponse)
async def get_jarvis_jev_status():
    """Report whether TypeSafe Jev is configured and which upstream provider is active."""
    typesafe_key, openrouter_key = _get_api_credentials()
    if typesafe_key:
        return JevStatusResponse(
            enabled=True,
            provider="typesafe",
            model="typesafe/jev-latest",
            active_key_source="TYPESAFE_API_KEY",
        )
    if openrouter_key:
        return JevStatusResponse(
            enabled=True,
            provider="openrouter",
            model=OPENROUTER_JEV_MODEL,
            active_key_source="OPENROUTER_API_KEY",
        )
    return JevStatusResponse(
        enabled=True,
        provider="fallback",
        model="bilingual-heuristic",
        active_key_source=None,
    )
