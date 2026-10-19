"""Write the MCP config a project needs so its agents pick up the team channel.

No MCP SDK here on purpose: this is called from the core when a team launches,
so it must stay importable without the optional dependency.
"""

from __future__ import annotations

import json
import os
import shutil
import tomllib
from pathlib import Path

# The key our server gets in the project's .mcp.json.
SERVER_KEY = "contextgit"
CONFIG_NAME = ".mcp.json"
SCRIPT_NAME = "contextgit-mcp"


def mcp_command() -> str:
    """The command an MCP client runs; the installed script when we can find it."""
    return os.getenv("CONTEXTGIT_MCP_COMMAND") or shutil.which(SCRIPT_NAME) or SCRIPT_NAME


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
        args = ["--mcp"] if os.getenv("CONTEXTGIT_MCP_COMMAND") else []
        environment = (
            {"CONTEXTGIT_ROOT": os.environ["CONTEXTGIT_ROOT"]}
            if os.getenv("CONTEXTGIT_ROOT")
            else {}
        )
        servers[SERVER_KEY] = {"command": mcp_command(), "args": args, "env": environment}
        data["mcpServers"] = servers
        path.write_text(f"{json.dumps(data, indent=2, sort_keys=True)}\n", encoding="utf-8")
        # Codex reads project MCP settings from TOML rather than .mcp.json.
        codex_config = root / ".codex" / "config.toml"
        codex_source = codex_config.read_text() if codex_config.exists() else ""
        codex_data = tomllib.loads(codex_source)
        if SERVER_KEY not in codex_data.get("mcp_servers", {}):
            codex_config.parent.mkdir(parents=True, exist_ok=True)
            codex_config.write_text(
                codex_source.rstrip()
                + "\n\n[mcp_servers.contextgit]\n"
                + f"command = {json.dumps(mcp_command())}\nargs = {json.dumps(args)}\n"
                + (
                    "[mcp_servers.contextgit.env]\n"
                    + "\n".join(
                        f"{key} = {json.dumps(value)}" for key, value in environment.items()
                    )
                    + "\n"
                    if environment
                    else ""
                )
            )
    except (OSError, ValueError):
        return None
    return path
