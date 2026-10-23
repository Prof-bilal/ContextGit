"""Write the MCP config a project needs so its agents pick up the team channel.

No MCP SDK here on purpose: this is called from the core when a team launches,
so it must stay importable without the optional dependency.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import subprocess
import tomllib
from pathlib import Path

# The key our server gets in the project's .mcp.json.
SERVER_KEY = "contextgit"
CONFIG_NAME = ".mcp.json"
SCRIPT_NAME = "contextgit-mcp"
RUN_ENV_VARS = (
    "CONTEXTGIT_REPO",
    "CONTEXTGIT_ROLE",
    "CONTEXTGIT_TEAM",
    "CONTEXTGIT_TASK",
    "CONTEXTGIT_RUN",
    "CONTEXTGIT_ROOT",
)


def _update_table(source: str, table: str, values: dict[str, object]) -> str:
    """Update our keys only; retain other servers, options and tool approvals."""
    header = re.compile(r"(?m)^\[" + re.escape(table) + r"\][ \t]*(?:#.*)?$")
    match = header.search(source)
    if match is None:
        source = source.rstrip() + f"\n\n[{table}]\n"
        match = header.search(source)
    assert match is not None
    next_header = re.search(r"(?m)^\[", source[match.end():])
    end = match.end() + next_header.start() if next_header else len(source)
    body = source[match.end():end]
    for key, value in values.items():
        # Existing args/env_vars may be formatted as multiline string arrays.
        line = f"{key} = {json.dumps(value)}"
        pattern = re.compile(
            r"(?m)^" + re.escape(key) + r"[ \t]*=[ \t]*(?:\[[\s\S]*?\]|[^\n]*)[^\n]*$"
        )
        if pattern.search(body):
            body = pattern.sub(lambda _: line, body)
        else:
            body = body.rstrip() + "\n" + line + "\n"
    return source[:match.end()] + body.rstrip() + "\n\n" + source[end:]


def mcp_command() -> str:
    """The command an MCP client runs; the installed script when we can find it."""
    sibling = Path(sys.executable).parent / (SCRIPT_NAME + (".exe" if os.name == "nt" else ""))
    return (
        os.getenv("CONTEXTGIT_MCP_COMMAND")
        or shutil.which(SCRIPT_NAME)
        or (str(sibling) if sibling.is_file() else SCRIPT_NAME)
    )


def opencode_v2() -> bool:
    version = subprocess.run([shutil.which("opencode") or "opencode", "--version"],
        capture_output=True, text=True, timeout=5, check=True,
        env={**os.environ, "OPENCODE_DISABLE_AUTOUPDATE": "true"}).stdout
    match = re.search(r"\bv?(\d+)\.", version)
    if match is None:
        raise ValueError("Could not identify the OpenCode configuration format")
    return int(match.group(1)) >= 2


def ensure_mcp_config(
    project_path: str | Path, *, run_env: dict[str, str] | None = None,
    agent: str | None = None, model: str | None = None,
) -> Path | None:
    """Merge a `contextgit` server into the project's `.mcp.json`.

    Never removes another server, and never raises: a read-only project simply
    gets no config file. Returns the path when it was written.
    Pass run_env only for an isolated run worktree; its role/team/repository
    binding must come from persisted session state, not agent-supplied input.
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
        if run_env is not None:
            # Only bind identity in an isolated run's worktree, never in the
            # shared project config. An absent task must not inherit a parent
            # or another worker's identity.
            environment.update({
                key: run_env.get(key, "")
                for key in RUN_ENV_VARS
                if key != "CONTEXTGIT_ROOT"
            })
        servers[SERVER_KEY] = {"command": mcp_command(), "args": args, "env": environment}
        data["mcpServers"] = servers
        path.write_text(f"{json.dumps(data, indent=2, sort_keys=True)}\n", encoding="utf-8")
        # Codex reads project MCP settings from TOML rather than .mcp.json.
        codex_config = root / ".codex" / "config.toml"
        codex_source = codex_config.read_text() if codex_config.exists() else ""
        codex_data = tomllib.loads(codex_source)
        existing = codex_data.get("mcp_servers", {}).get(SERVER_KEY, {})
        forwarded = list(dict.fromkeys([*existing.get("env_vars", []), *RUN_ENV_VARS]))
        codex_source = _update_table(codex_source, "mcp_servers.contextgit", {
            "command": mcp_command(), "args": args, "env_vars": forwarded,
        })
        if environment:
            codex_source = _update_table(codex_source, "mcp_servers.contextgit.env", environment)
        # Validate before replacing a config containing the user's settings.
        tomllib.loads(codex_source)
        codex_config.parent.mkdir(parents=True, exist_ok=True)
        codex_config.write_text(codex_source, encoding="utf-8")
        if agent == "opencode" and run_env is not None:
            # A private per-run overlay leaves the project's JSON/JSONC and
            # provider configuration untouched. V2 changed the MCP nesting.
            try:
                v2 = opencode_v2()
            except (OSError, subprocess.SubprocessError):
                return None
            local = {"type": "local", "command": [mcp_command(), *args], "environment": environment}
            servers = {SERVER_KEY: local}
            overlay: dict[str, object] = {"mcp": {"servers": servers} if v2 else servers}
            if model:
                overlay["model"] = model
            target = root / ".contextgit" / "opencode.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(overlay, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError):
        return None
    return path
