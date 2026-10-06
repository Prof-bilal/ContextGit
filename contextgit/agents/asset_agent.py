"""The asset agent: turn an instruction plus the asset catalog into a JSON plan.

Provider and key resolution live in `contextgit.llm.registry`; this module only
builds the prompt and parses (and validates) the model's reply into a list of
action dicts the desktop app can execute.
"""

from __future__ import annotations

import json
import re
from typing import Any

MAX_CATALOG = 400

SYSTEM_PROMPT = (
    "You are the asset librarian for a desktop app. You manage an app-level "
    "library of images, video, audio and documents, organised into folders. "
    "You are given the current catalog and a user instruction. Reply with a plan "
    "of actions as strict JSON only — no prose, no markdown fences — in this "
    'shape: {"actions":[{"type":"create_folder","path":"Logos"},'
    '{"type":"move","ids":["<id>"],"folder":"Logos"},'
    '{"type":"rename","id":"<id>","name":"new name.png"},'
    '{"type":"tag","id":"<id>","tags":["hero","v2"]},'
    '{"type":"note","id":"<id>","text":"why this matters"},'
    '{"type":"delete","ids":["<id>"]}]}. '
    "Rules: use only asset ids from the catalog; folders are slash-separated "
    "paths; prefer create_folder before move; do not delete unless the "
    'instruction clearly asks for it; if nothing should change reply {"actions":[]}.'
)

_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def build_prompt(assets: list[dict[str, Any]], folders: list[str], instruction: str) -> str:
    """The user message: the folder list, the asset catalog, then the instruction."""
    shown = assets[:MAX_CATALOG]
    lines = [
        f"{a.get('id', '')}\t{a.get('name', '')}\t{a.get('kind', '')}"
        f"\tfolder={a.get('folder') or '(root)'}"
        f"\ttags={','.join(a.get('tags') or []) or '-'}"
        for a in shown
    ]
    folder_block = "\n".join(f"- {name}" for name in folders) or "(none)"
    count = f"{len(shown)}{f' of {len(assets)}' if len(assets) > MAX_CATALOG else ''}"
    return (
        "FOLDERS:\n"
        f"{folder_block}\n\n"
        f"ASSETS ({count}) — id, name, kind, folder, tags:\n"
        + "\n".join(lines)
        + "\n\n"
        "Return the JSON plan now."
    )


def _is_action(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    kind = value.get("type")
    if kind == "create_folder":
        return isinstance(value.get("path"), str)
    if kind == "move":
        return isinstance(value.get("ids"), list) and isinstance(value.get("folder"), str)
    if kind == "rename":
        return isinstance(value.get("id"), str) and isinstance(value.get("name"), str)
    if kind == "tag":
        return isinstance(value.get("id"), str) and isinstance(value.get("tags"), list)
    if kind == "note":
        return isinstance(value.get("id"), str) and isinstance(value.get("text"), str)
    if kind == "delete":
        return isinstance(value.get("ids"), list)
    return False


def parse_actions(text: str) -> list[dict[str, Any]]:
    """Parse the model's reply into validated action dicts (empty on failure)."""
    fenced = _FENCE.search(text)
    cleaned = (fenced.group(1) if fenced else text).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("the model did not return valid JSON") from exc
    raw = parsed.get("actions") if isinstance(parsed, dict) else parsed
    if not isinstance(raw, list):
        raise ValueError("the model returned no actions list")
    return [action for action in raw if _is_action(action)]
