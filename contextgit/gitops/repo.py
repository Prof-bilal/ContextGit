"""Thin, typed wrapper over the `git` command line."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from .errors import GitCommandError, NotAGitRepo

_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True)
class CommandResult:
    """Captured result of one git invocation."""

    returncode: int
    stdout: str
    stderr: str


class Git:
    """Run git commands in a fixed working directory."""

    def __init__(self, cwd: Path | str) -> None:
        self.cwd = Path(cwd)

    def run(self, *args: str, check: bool = True) -> CommandResult:
        """Run `git <args>` here; raise GitCommandError unless check is False."""
        try:
            proc = subprocess.run(
                ["git", *args],
                cwd=self.cwd,
                capture_output=True,
                text=True,
                timeout=_TIMEOUT_SECONDS,
            )
        except FileNotFoundError as exc:
            raise GitCommandError("git is not installed") from exc
        except subprocess.TimeoutExpired as exc:
            raise GitCommandError(f"git {' '.join(args)} timed out") from exc
        result = CommandResult(proc.returncode, proc.stdout, proc.stderr)
        if check and proc.returncode != 0:
            detail = proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
            raise GitCommandError(f"git {' '.join(args)} failed: {detail}")
        return result

    def is_repo(self) -> bool:
        """True when the directory is inside a git working tree."""
        return self.run("rev-parse", "--is-inside-work-tree", check=False).stdout.strip() == "true"

    def top_level(self) -> Path:
        """Absolute path of the repository root."""
        if not self.is_repo():
            raise NotAGitRepo(f"{self.cwd} is not a git working tree")
        return Path(self.run("rev-parse", "--show-toplevel").stdout.strip())

    def rev_parse(self, ref: str) -> str:
        """Resolve a ref to a commit SHA."""
        return self.run("rev-parse", "--verify", f"{ref}^{{commit}}").stdout.strip()

    def merge_base(self, a: str, b: str) -> str | None:
        """Common ancestor of two refs, or None if they are unrelated."""
        out = self.run("merge-base", a, b, check=False).stdout.strip()
        return out or None

    def current_branch(self) -> str:
        """The checked-out branch name (or 'HEAD' when detached)."""
        return self.run("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()

    def changed_files(self, base: str) -> list[str]:
        """Paths changed against `base`, including untracked files."""
        tracked = self.run("diff", "--name-only", "-z", base).stdout
        untracked = self.run("ls-files", "--others", "--exclude-standard", "-z").stdout
        paths = {line for line in f"{tracked}\0{untracked}".split("\0") if line}
        return sorted(paths)

    def is_dirty(self) -> bool:
        """True when there are staged or unstaged changes here."""
        return bool(self.run("status", "--porcelain").stdout.strip())
