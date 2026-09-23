"""OpenRouter TTS backend for ``tools.tts_tool``: Flux / Fish Audio free voices.

Official endpoint ``POST {base_url}/audio/speech`` (default base
``https://openrouter.ai/api/v1``) with JSON ``{model, input, voice}`` plus
optional ``response_format`` (``mp3`` | ``pcm``) and ``speed``. Success is raw
audio bytes (``audio/*``); failures are JSON ``{"error": ...}`` — even the
HTTP status may be 200 with a JSON body, so the Content-Type decides.

Model/voice defaults were verified against the official model pages
(``.../models/<id>`` ``llms.txt``, Sep 2026):

- ``deepgram/flux-tts:free`` — voice enum (``flux-alexis-en``,
  ``flux-bree-en``, …); docs example uses ``flux-alexis-en`` (default here).
- ``fish-audio/s2.1-pro-free:free`` — free-form voice id; docs example uses
  ``b347db033a6549378b48d00acb0d06cd`` (default when the model is Fish Audio
  and no usable voice is configured).

OpenRouter exposes no chunked/streaming TTS API, so there is deliberately no
``tts_streaming`` streamer registration: the speaker pipeline and the
``/api/audio/speak-stream`` socket fall back to per-sentence sync synthesis,
which preserves the user's chosen voice and still overlaps speech with
generation. Credentials use the existing ``OPENROUTER_API_KEY`` secret
(config ``tts.openrouter.api_key`` wins); no new env var.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from tools.tts_tool_delivery import _origin, _section, _wrap_pcm_as_wav, _write_wav_bytes_as
from tools.tts_tool_providers import _post_json, _read_tts_response_bytes

logger = logging.getLogger("tools.tts_tool")

DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_OPENROUTER_MODEL = "deepgram/flux-tts:free"
#: First voice of the official Flux enum; also the docs example voice.
DEFAULT_OPENROUTER_VOICE = "flux-alexis-en"
#: Voice from the official Fish Audio docs example (free-form id space).
DEFAULT_FISH_AUDIO_VOICE = "b347db033a6549378b48d00acb0d06cd"
#: The exact free model ids the user asked for; config may pin any other id.
OPENROUTER_TTS_MODELS = (
    "deepgram/flux-tts:free",
    "fish-audio/s2.1-pro-free:free",
)


def _resolve_openrouter_voice(model: str, configured: Any) -> str:
    """Pick the voice id for *model*: any explicitly chosen voice is sent
    verbatim; only an unset voice — or the untouched Flux default left over
    from switching ``tts.openrouter.model`` to Fish Audio (and vice versa) —
    falls back to the per-model default.
    """
    voice = str(configured or "").strip()
    is_fish = "fish-audio" in (model or "").lower()
    if not voice or voice == DEFAULT_OPENROUTER_VOICE:
        return DEFAULT_FISH_AUDIO_VOICE if is_fish else DEFAULT_OPENROUTER_VOICE
    if not is_fish and voice == DEFAULT_FISH_AUDIO_VOICE:
        return DEFAULT_OPENROUTER_VOICE
    return voice


def _openrouter_response_format(output_path: str) -> str:
    """``pcm`` for ``.wav`` (wrapped into a WAV container on receipt), else ``mp3``.

    OpenRouter only serves ``mp3`` | ``pcm``; an explicit ``.ogg`` caller path
    receives MP3 bytes and the shared ``_repair_ogg_container`` sniff
    transcodes/renames it downstream.
    """
    return "pcm" if output_path.lower().endswith(".wav") else "mp3"


def _openrouter_error_detail(response: Any) -> str:
    """Best-effort ``error.message`` from a failed reply, else the first 300 body chars."""
    try:
        raw = _read_tts_response_bytes(response, label="OpenRouter TTS")
    except Exception:
        return f"HTTP {getattr(response, 'status_code', '?')}"
    try:
        import json as _json

        error = _json.loads(raw.decode("utf-8")).get("error") if raw else None
        if isinstance(error, dict):
            message = error.get("message")
        else:
            message = error
        if message:
            return str(message)[:300]
    except Exception:
        pass
    status = getattr(response, "status_code", "?")
    snippet = (raw or b"").decode("utf-8", errors="replace")[:300]
    return f"HTTP {status}: {snippet}" if snippet else f"HTTP {status}"


def _generate_openrouter_tts(text: str, output_path: str, tts_config: Dict[str, Any]) -> str:
    """Generate audio via OpenRouter ``POST /audio/speech``; returns *output_path*."""
    origin = _origin()
    section = _section(tts_config, "openrouter")
    api_key = str(section.get("api_key") or "").strip() or (
        origin._resolve_provider_key("OPENROUTER_API_KEY", "openrouter") or ""
    ).strip()
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY not set. Get one at https://openrouter.ai/keys")
    model = str(section.get("model") or DEFAULT_OPENROUTER_MODEL).strip() or DEFAULT_OPENROUTER_MODEL
    voice = _resolve_openrouter_voice(model, section.get("voice"))
    base_url = str(
        section.get("base_url") or DEFAULT_OPENROUTER_BASE_URL
    ).strip().rstrip("/") or DEFAULT_OPENROUTER_BASE_URL
    response_format = _openrouter_response_format(output_path)
    payload: Dict[str, Any] = {
        "model": model, "input": text, "voice": voice, "response_format": response_format,
    }
    try:
        speed = float(section.get("speed", tts_config.get("speed", 1.0)))
    except (TypeError, ValueError):
        speed = 1.0
    if speed != 1.0:
        # Documented as honored only by models that support it, ignored otherwise.
        payload["speed"] = max(0.25, min(4.0, speed))
    response = _post_json(
        f"{base_url}/audio/speech", payload,
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    content_type = str(getattr(response, "headers", {}).get("Content-Type", "") or "")
    status = getattr(response, "status_code", 200)
    if status != 200 or "audio/" not in content_type.lower():
        # Gateways may answer errors as JSON with or without a 4xx/5xx status.
        raise RuntimeError(
            f"OpenRouter TTS API error (model {model}): {_openrouter_error_detail(response)}")
    audio_bytes = _read_tts_response_bytes(response, label="OpenRouter TTS")
    if not audio_bytes:
        raise RuntimeError(f"OpenRouter TTS returned empty audio data (model {model})")
    if response_format == "pcm":
        # ``audio/pcm`` is 16-bit little-endian; the channel count/rate are not
        # advertised, so wrap at the 24 kHz mono the rest of the pipeline uses.
        return _write_wav_bytes_as(_wrap_pcm_as_wav(audio_bytes), output_path)
    with open(output_path, "wb") as f:
        f.write(audio_bytes)
    return output_path
