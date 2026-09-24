"""Plugin-registered TTS providers for ``tools.tts_tool``: routes ``tts.provider: <name>`` values
that are neither built-in nor ``type: command`` to a plugin :class:`agent.tts_provider.TTSProvider`.
Discovery goes through ``hermes_cli.plugins._ensure_plugins_discovered`` (imported lazily so the
tool module stays importable without the plugin machinery).
"""

from __future__ import annotations
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from agent.tts_provider import VALID_OUTPUT_FORMATS
from tools.tts_command_provider import (
    BUILTIN_TTS_PROVIDERS, DEFAULT_COMMAND_TTS_OUTPUT_FORMAT, _get_named_provider_config,
    _is_command_provider_config)
from tools.tts_tool_delivery import _configured_output_format, _provider_config, _provider_speed

logger = logging.getLogger("tools.tts_tool")


def _lookup_plugin_provider(key: str, *, discover: bool = True, retry: bool = False):
    """The registered ``TTSProvider`` named *key*, or None. ``discover`` runs plugin discovery first;
    ``retry`` re-discovers with ``force=True`` on a miss (a long-lived session may predate the
    plugin's install). Raises on registry/discovery failure — callers decide if fatal."""
    from agent.tts_registry import get_provider
    if discover:
        from hermes_cli.plugins import _ensure_plugins_discovered
        _ensure_plugins_discovered()
    plugin_provider = get_provider(key)
    if plugin_provider is None and retry:
        _ensure_plugins_discovered(force=True)
        plugin_provider = get_provider(key)
    return plugin_provider


def _dispatch_to_plugin_provider(text: str, output_path: str, provider: str, tts_config: Dict[str, Any]) -> Optional[str]:
    """Route to a plugin-registered TTS provider; None means "fall through".

    Invariants re-checked here so a caller refactor can't break them: built-in names never reach
    the registry; a same-named ``type: command`` provider wins; only an exact registered name
    dispatches. Plugin exceptions propagate to ``text_to_speech_tool``'s error envelope.

    Resolution invariants enforced here (matches issue #30398):
    1. The caller is responsible for the elif chain that handles ``edge``/``openai``/etc.; this function
    explicitly rejects those names defensively. 2. 3. Plugin dispatch fires only when ``provider`` matches a
    registered :class:`TTSProvider` whose ``name`` equals the configured value. Unknown names return None
    (caller falls through to Edge default). See #17843.
    """
    key = (provider or "").lower().strip()
    if not key or key in BUILTIN_TTS_PROVIDERS:
        return None
    if _is_command_provider_config(_get_named_provider_config(tts_config, key)):
        return None
    try:
        plugin_provider = _lookup_plugin_provider(key, retry=True)
    except Exception as exc:  # noqa: BLE001 — discovery failure is non-fatal
        logger.debug("tts plugin dispatch skipped (discovery failed): %s", exc)
        return None
    if plugin_provider is None:
        return None
    cfg = tts_config if isinstance(tts_config, dict) else {}
    provider_cfg = _provider_config(cfg, key)

    def _setting(name: str):
        value = provider_cfg.get(name)
        return value if value not in (None, "") else cfg.get(name)

    voice = _setting("voice")
    model = _setting("model")
    speed = _provider_speed(cfg, key)
    output_format = _configured_output_format(cfg, key) or DEFAULT_COMMAND_TTS_OUTPUT_FORMAT
    output_suffix = Path(output_path).suffix.lower().strip().lstrip(".")
    if output_suffix in VALID_OUTPUT_FORMATS:
        output_format = output_suffix
    logger.info("Generating speech with plugin TTS provider '%s'...", key)
    written = plugin_provider.synthesize(
        text, output_path, voice=str(voice) if voice else None,
        model=str(model) if model else None, speed=float(speed), format=output_format)
    return written if isinstance(written, str) and written else output_path


def _plugin_provider_is_voice_compatible(provider: str) -> bool:
    """True when the registered plugin provider opts into voice-bubble delivery (any failure -> False)."""
    key = (provider or "").lower().strip()
    if not key or key in BUILTIN_TTS_PROVIDERS:
        return False
    try:
        plugin_provider = _lookup_plugin_provider(key, discover=False)
        return plugin_provider is not None and bool(plugin_provider.voice_compatible)
    except Exception as exc:  # noqa: BLE001
        logger.debug("tts plugin voice_compatible check failed for '%s': %s", key, exc)
        return False


def _plugin_provider_is_available(provider: str) -> bool:
    """``check_fn`` leg for plugin names: discovered provider reports ``is_available()``; any failure is False."""
    try:
        plugin = _lookup_plugin_provider(provider)
        return bool(plugin and plugin.is_available())
    except Exception:
        return False
