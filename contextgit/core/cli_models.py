"""Read model catalogs from installed CLIs without launching an agent."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

TEAM_CLIS = {"codex", "claude", "opencode", "commandcode"}
MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/+@\[\]-]{0,199}\Z")


def validate_model(model: str | None) -> str | None:
    if model and not MODEL_ID.fullmatch(model):
        raise ValueError("Choose a valid CLI model ID")
    return model or None


def catalog(agent: str) -> dict[str, object]:
    if agent not in TEAM_CLIS:
        raise ValueError("Unsupported team CLI")
    command = shutil.which("command-code" if agent == "commandcode" else agent)
    if not command:
        return {"models": [], "source": "unavailable", "message": "Install this CLI to discover its models."}
    if agent == "claude":
        # Claude exposes stable aliases, not a public CLI model-list command.
        return {"models": [{"id": key, "label": label} for key, label in
                [("opus", "Opus"), ("sonnet", "Sonnet"), ("haiku", "Haiku")]],
                "source": "cli-aliases", "message": "Claude aliases; enter a custom ID for another configured model."}
    args = {"codex": ["debug", "models"], "opencode": ["models"],
            "commandcode": ["--no-auto-update", "--list-models"]}[agent]
    try:
        output = subprocess.run([command, *args], stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=15, check=True,
            env={**os.environ, "NO_COLOR": "1", "OPENCODE_DISABLE_AUTOUPDATE": "true"}).stdout
        if agent == "codex":
            rows = json.loads(output)["models"]
            models = [{"id": row["slug"], "label": row.get("display_name") or row["slug"]}
                      for row in rows if row.get("visibility", "list") == "list"]
        else:
            output = re.sub(r"\x1b\[[0-9;]*m", "", output)
            # Decision-only models cannot drive an interactive terminal.
            if agent == "commandcode":
                output = re.split(r"(?im)^Decision models \(headless only\).*$", output)[0]
            lines = output.splitlines()
            ids = [line.split()[0] for line in lines if line.strip()
                   and any(char in line.split()[0] for char in ("/", "-"))]
            models = [{"id": key, "label": key} for key in dict.fromkeys(ids) if MODEL_ID.fullmatch(key)]
        return {"models": models, "source": "installed-cli", "message": "Models reported by your installed CLI; access depends on provider sign-in."}
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        if agent == "codex":
            try:
                cache = Path(os.getenv("CODEX_HOME") or Path.home() / ".codex") / "models_cache.json"
                rows = json.loads(cache.read_text())["models"]
                return {"models": [{"id": row["slug"], "label": row.get("display_name") or row["slug"]}
                                   for row in rows if row.get("visibility", "list") == "list"],
                        "source": "cached", "message": "Cached Codex catalog; refresh after signing in for updates."}
            except (OSError, ValueError, KeyError, TypeError):
                pass
        return {"models": [], "source": "unavailable", "message": "Catalog unavailable. Use the CLI default or enter a configured model ID."}
