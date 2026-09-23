"""DSML (DeepSeek Markup Language) and text-embedded tool call parser.

DeepSeek V3 / R1 / Eva-AI models and proxies occasionally emit tool calls as
in-band DSML XML markup instead of structured JSON tool_calls in the API response:
    <｜｜DSML｜｜ calls>
    <｜｜DSML｜｜ invoke name="tool_name">
    <｜｜DSML｜｜ parameter name="arg" string="true">value</｜｜DSML｜｜ parameter>
    </｜｜DSML｜｜ invoke>
    </｜｜DSML｜｜ calls>

This module detects, extracts, and strips DSML and <tool_call> blocks so:
1. Tool calls are converted to standard OpenAI ToolCall objects and executed.
2. Raw markup tags never leak to the chat UI or user display.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)

# Matches opening/closing of DSML calls block with either fullwidth vertical bar (\uff5c) or ASCII (|)
_DSML_CALLS_BLOCK_RE = re.compile(
    r'<[/]?[|\uff5c]{2}DSML[|\uff5c]{2}\s*calls>',
    re.IGNORECASE,
)

_DSML_FULL_BLOCK_RE = re.compile(
    r'<[|\uff5c]{2}DSML[|\uff5c]{2}\s*calls>(.*?)</[|\uff5c]{2}DSML[|\uff5c]{2}\s*calls>',
    re.DOTALL | re.IGNORECASE,
)

# Matches individual <... invoke name="..."> ... </... invoke>
_DSML_INVOKE_RE = re.compile(
    r'<[|\uff5c]{2}DSML[|\uff5c]{2}\s*invoke\s+name=["\'](?P<name>[^"\']+)["\']\s*>(.*?)</[|\uff5c]{2}DSML[|\uff5c]{2}\s*invoke>',
    re.DOTALL | re.IGNORECASE,
)

# Matches <... parameter name="..." string="true|false"> ... </... parameter>
_DSML_PARAM_RE = re.compile(
    r'<[|\uff5c]{2}DSML[|\uff5c]{2}\s*parameter\s+name=["\'](?P<param>[^"\']+)["\'](?:\s+string=["\']?(?P<is_str>true|false)["\']?)?\s*>(.*?)</[|\uff5c]{2}DSML[|\uff5c]{2}\s*parameter>',
    re.DOTALL | re.IGNORECASE,
)

# Standard <tool_call> JSON block format
_TOOL_CALL_BLOCK_RE = re.compile(
    r'<tool_call>(.*?)</tool_call>',
    re.DOTALL | re.IGNORECASE,
)


def is_dsml_or_tool_call_text(text: str) -> bool:
    """Return True if text contains DSML or <tool_call> tags."""
    if not text or not isinstance(text, str):
        return False
    return (
        ("DSML" in text and ("<" in text or "\uff5c" in text))
        or "<tool_call>" in text
        or "<tool_call " in text
    )


def stream_text_may_be_dsml(text: str) -> bool:
    """Fast check whether an in-flight stream fragment may be the beginning of a DSML block."""
    if not text or not isinstance(text, str):
        return False
    stripped = text.lstrip()
    return (
        stripped.startswith("<")
        and (
            "DSML" in stripped
            or "\uff5c" in stripped
            or stripped.startswith(("<｜", "<|", "<tool_call", "</tool_call", "</｜", "</|"))
        )
    )


def extract_dsml_and_text_tool_calls(text: str) -> Tuple[List[Dict[str, Any]], str]:
    """Extract tool calls from DSML or <tool_call> tags in text.

    Returns:
        (tool_calls, cleaned_text):
            tool_calls: list of dicts formatted as OpenAI tool call dicts:
                {
                    "id": "call_...",
                    "type": "function",
                    "function": {"name": ..., "arguments": json_string}
                }
            cleaned_text: text with the tool call blocks removed.
    """
    if not text or not isinstance(text, str):
        return [], text or ""

    tool_calls: List[Dict[str, Any]] = []
    consumed_spans: List[Tuple[int, int]] = []

    # 1. Parse DSML blocks (<｜｜DSML｜｜ calls> ... </｜｜DSML｜｜ calls>)
    for m_block in _DSML_FULL_BLOCK_RE.finditer(text):
        consumed_spans.append((m_block.start(), m_block.end()))
        block_content = m_block.group(1)

        for m_inv in _DSML_INVOKE_RE.finditer(block_content):
            fn_name = m_inv.group("name").strip()
            inv_content = m_inv.group(2)
            args_dict: Dict[str, Any] = {}

            for m_param in _DSML_PARAM_RE.finditer(inv_content):
                p_name = m_param.group("param").strip()
                is_str = (m_param.group("is_str") or "").lower() == "true"
                raw_val = m_param.group(3)
                # Strip leading/trailing newline if present, but preserve indentation/content
                val = raw_val.strip("\r\n")
                if not is_str:
                    try:
                        args_dict[p_name] = json.loads(val.strip())
                    except Exception:
                        args_dict[p_name] = val.strip()
                else:
                    args_dict[p_name] = val.strip()

            tool_calls.append({
                "id": f"call_dsml_{uuid.uuid4().hex[:8]}",
                "type": "function",
                "function": {
                    "name": fn_name,
                    "arguments": json.dumps(args_dict, ensure_ascii=False),
                },
            })

    # 1b. If no full block matched, parse standalone or unclosed DSML invokes
    if not tool_calls:
        for m_inv in _DSML_INVOKE_RE.finditer(text):
            consumed_spans.append((m_inv.start(), m_inv.end()))
            fn_name = m_inv.group("name").strip()
            inv_content = m_inv.group(2)
            args_dict = {}

            for m_param in _DSML_PARAM_RE.finditer(inv_content):
                p_name = m_param.group("param").strip()
                is_str = (m_param.group("is_str") or "").lower() == "true"
                raw_val = m_param.group(3)
                val = raw_val.strip("\r\n")
                if not is_str:
                    try:
                        args_dict[p_name] = json.loads(val.strip())
                    except Exception:
                        args_dict[p_name] = val.strip()
                else:
                    args_dict[p_name] = val.strip()

            tool_calls.append({
                "id": f"call_dsml_{uuid.uuid4().hex[:8]}",
                "type": "function",
                "function": {
                    "name": fn_name,
                    "arguments": json.dumps(args_dict, ensure_ascii=False),
                },
            })

        for m_calls in _DSML_CALLS_BLOCK_RE.finditer(text):
            consumed_spans.append((m_calls.start(), m_calls.end()))

    # 2. Parse standard <tool_call> JSON blocks
    for m_tc in _TOOL_CALL_BLOCK_RE.finditer(text):
        consumed_spans.append((m_tc.start(), m_tc.end()))
        tc_content = m_tc.group(1).strip()
        try:
            parsed = json.loads(tc_content)
            if isinstance(parsed, dict) and "name" in parsed:
                fn_name = parsed["name"]
                args = parsed.get("arguments", {})
                if not isinstance(args, str):
                    args = json.dumps(args, ensure_ascii=False)
                tool_calls.append({
                    "id": parsed.get("id") or f"call_tc_{uuid.uuid4().hex[:8]}",
                    "type": "function",
                    "function": {
                        "name": fn_name,
                        "arguments": args,
                    },
                })
        except Exception:
            logger.debug("Failed parsing <tool_call> JSON block: %s", tc_content[:100])

    if not consumed_spans:
        # Check if there are unclosed or loose DSML tags to clean up
        cleaned = strip_dsml_tags(text)
        return tool_calls, cleaned.strip()

    # Reconstruct text excluding consumed spans
    consumed_spans.sort()
    merged_spans: List[Tuple[int, int]] = []
    for s, e in consumed_spans:
        if not merged_spans or s > merged_spans[-1][1]:
            merged_spans.append((s, e))
        else:
            merged_spans[-1] = (merged_spans[-1][0], max(merged_spans[-1][1], e))

    clean_parts: List[str] = []
    curr = 0
    for s, e in merged_spans:
        if curr < s:
            clean_parts.append(text[curr:s])
        curr = max(curr, e)
    if curr < len(text):
        clean_parts.append(text[curr:])

    cleaned_text = "".join(clean_parts)
    # Further clean any dangling DSML tags that weren't fully closed
    cleaned_text = strip_dsml_tags(cleaned_text).strip()
    return tool_calls, cleaned_text


def strip_dsml_tags(text: str) -> str:
    """Remove any remaining DSML or <tool_call> tags from text."""
    if not text or not isinstance(text, str):
        return ""
    # Strip full blocks if any remain
    cleaned = _DSML_FULL_BLOCK_RE.sub("", text)
    cleaned = _TOOL_CALL_BLOCK_RE.sub("", cleaned)
    # Strip standalone invoke blocks and parameter blocks
    cleaned = _DSML_INVOKE_RE.sub("", cleaned)
    cleaned = _DSML_PARAM_RE.sub("", cleaned)
    # Strip individual or loose tags
    cleaned = re.sub(r'</?[|\uff5c]{2}\s*DSML\s*[|\uff5c]{2}[^>]*>', '', cleaned)
    cleaned = re.sub(r'</?tool_call[^>]*>', '', cleaned)
    return cleaned
