"""Fill-in-the-middle completion: the prompt and the reply cleanup.

The editor extension sends the code around the cursor; this turns that into a
strict "return only the inserted text" prompt and cleans the model's reply so the
ghost text is exactly what the user sees.
"""

from __future__ import annotations

import re

SYSTEM_PROMPT = (
    "You are a code completion engine embedded in an editor. "
    "Reply with ONLY the code that belongs at the cursor — no prose, no markdown "
    "fences, no explanation. Match the surrounding style and indentation exactly. "
    "If nothing belongs there, reply with an empty string."
)

_FENCE = re.compile(r"```[^`\n]*\n?([\s\S]*?)```")
_FIM_MARKERS = (
    "<|fim_middle|>",
    "<|fim_end|>",
    "<|endoftext|>",
    "<|endofmask|>",
    "</CURSOR_CONTEXT>",
    "<CURSOR_CONTEXT>",
)


def build_prompt(language: str, filename: str, prefix: str, suffix: str) -> str:
    """The user message: the file around the cursor, with a single `<CURSOR>` marker."""
    return (
        f"File: {filename or 'untitled'}\n"
        f"Language: {language or 'unknown'}\n"
        "Complete the code exactly at the <CURSOR> marker. Return only the text to insert.\n\n"
        "<CURSOR_CONTEXT>\n"
        f"{prefix}<CURSOR>{suffix}\n"
        "</CURSOR_CONTEXT>"
    )


def clean_completion(text: str) -> str:
    """Strip fences/FIM markers; drop a leading blank line and trailing whitespace."""
    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1)
    for marker in _FIM_MARKERS:
        text = text.replace(marker, "")
    if text.startswith("\n"):
        text = text[1:]
    return text.rstrip()
