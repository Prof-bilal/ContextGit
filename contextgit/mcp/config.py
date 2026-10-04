"""Write the MCP config a project needs so its agents pick up the team channel.

No MCP SDK here on purpose: this is called from the core when a team launches,
so it must stay importable without the optional dependency.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

# The key our server gets in the project's .mcp.json.
SERVER_KEY = "contextgit"
CONFIG_NAME = ".mcp.json"
SCRIPT_NAME = "contextgit-mcp"


def mcp_command() -> str:
    """The command an MCP client runs; the installed script when we can find it."""
    return shutil.which(SCRIPT_NAME) or SCRIPT_NAME


def ensure_mcp_config(project_path: str | Path) -> Path | None:
    """Merge a `contextgit` server into the project's `.mcp.json`.

    Never removes another server, and never raises: a read-only project simply
    gets no config file. Returns the path when it was written.
    """
    root = Path(project_path)
    path = root / CONFIG_NAME
    try:
        data: dict[str, object] = {}
        if path.is_file():
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
        servers = data.get("mcpServers")
        if not isinstance(servers, dict):
            servers = {}
        servers[SERVER_KEY] = {"command": mcp_command(), "args": []}
        data["mcpServers"] = servers
        path.write_text(f"{json.dumps(data, indent=2, sort_keys=True)}\n", encoding="utf-8")
    except (OSError, ValueError):
        return None
    return path
