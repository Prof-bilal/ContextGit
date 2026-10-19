"""Identify uncommitted implementation files separately from generated agent context."""

import re
from pathlib import Path

from contextgit.gitops.repo import Git


def uncommitted_code(worktree: str) -> list[str]:
    git = Git(worktree)
    tracked = set(git.run("diff", "--name-only", "-z", "HEAD").stdout.split("\0")) - {""}
    untracked = set(
        git.run("ls-files", "--others", "--exclude-standard", "-z").stdout.split("\0")
    ) - {""}
    managed = {".mcp.json", ".codex/config.toml"}
    untracked -= managed | {"AGENTS.md"}
    tracked -= managed
    if "AGENTS.md" in tracked:

        def without_context(text: str) -> str:
            for begin, end in [
                ("<!-- contextgit:begin -->", "<!-- contextgit:end -->"),
                ("<!-- contextgit:team:begin -->", "<!-- contextgit:team:end -->"),
            ]:
                text = re.sub(re.escape(begin) + ".*?" + re.escape(end), "", text, flags=re.S)
            return text.strip()

        path = Path(worktree) / "AGENTS.md"
        if path.exists() and without_context(path.read_text()) == without_context(
            git.run("show", "HEAD:AGENTS.md").stdout
        ):
            tracked.remove("AGENTS.md")
    return sorted(tracked | untracked)
