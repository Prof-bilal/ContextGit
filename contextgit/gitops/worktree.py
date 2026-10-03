"""One git worktree (and branch) per agent run."""

from __future__ import annotations

import builtins
from dataclasses import dataclass
from pathlib import Path

from .errors import DirtyWorktree, NotAGitRepo, WorktreeExists, WorktreeNotFound
from .repo import Git

WORKTREES_DIRNAME = ".contextgit/worktrees"


@dataclass(frozen=True)
class WorktreeInfo:
    """A registered worktree as reported by `git worktree list`."""

    path: Path
    branch: str | None
    head: str


class WorktreeManager:
    """Create, inspect and remove per-run git worktrees for one project."""

    def __init__(self, project: Path | str, root: Path | str | None = None) -> None:
        self.project = Path(project)
        self.git = Git(self.project)
        self.root = (
            Path(root) if root is not None else self.project / WORKTREES_DIRNAME
        )

    @classmethod
    def from_worktree(cls, worktree_path: Path | str) -> WorktreeManager:
        """Recover the manager for a worktree created at the default root."""
        path = Path(worktree_path)
        root = path.parent
        return cls(root.parent.parent, root=root)

    @property
    def available(self) -> bool:
        """True when the project folder is a git working tree."""
        return self.git.is_repo()

    def path_for(self, name: str) -> Path:
        """Absolute path of the worktree for a run name."""
        if "/" in name or "\\" in name or name in {"", ".", ".."}:
            raise ValueError(f"invalid worktree name: {name!r}")
        return self.root / name

    def create(self, name: str, *, branch: str | None = None, base: str = "HEAD") -> Path:
        """Add a worktree for `name` on a new branch based on `base`."""
        if not self.available:
            raise NotAGitRepo(f"{self.project} is not a git working tree")
        target = self.path_for(name)
        if target.exists():
            raise WorktreeExists(f"worktree already exists at {target}")
        self._ensure_ignored()
        target.parent.mkdir(parents=True, exist_ok=True)
        self.git.run("worktree", "add", "-b", branch or f"ctx/{name}", str(target), base)
        return target

    def remove(self, name: str, *, force: bool = False) -> None:
        """Remove a worktree; refuse when it holds uncommitted work unless forced."""
        target = self.path_for(name)
        if not target.exists():
            raise WorktreeNotFound(f"no worktree at {target}")
        if not force and Git(target).is_dirty():
            raise DirtyWorktree(f"{target} has uncommitted changes; force to remove")
        args = ["worktree", "remove", str(target)]
        if force:
            args.append("--force")
        self.git.run(*args)

    def list(self) -> builtins.list[WorktreeInfo]:
        """Every registered worktree, including the main checkout."""
        out = self.git.run("worktree", "list", "--porcelain").stdout
        infos: builtins.list[WorktreeInfo] = []
        for block in out.split("\n\n"):
            fields: dict[str, str] = {}
            for line in block.splitlines():
                key, _, value = line.partition(" ")
                fields[key] = value
            path = fields.get("worktree")
            if not path:
                continue
            branch = fields.get("branch", "").removeprefix("refs/heads/") or None
            infos.append(WorktreeInfo(path=Path(path), branch=branch, head=fields.get("HEAD", "")))
        return infos

    def changed_files(self, name: str, base_commit: str) -> builtins.list[str]:
        """Files a run has changed relative to its base commit."""
        return Git(self.path_for(name)).changed_files(base_commit)

    def _ensure_ignored(self) -> None:
        """Keep `.contextgit/` (worktrees + repo) out of the project's git status."""
        gitignore = self.project / ".gitignore"
        try:
            existing = gitignore.read_text(encoding="utf-8") if gitignore.exists() else ""
        except OSError:
            return
        if any(line.strip().rstrip("/") == ".contextgit" for line in existing.splitlines()):
            return
        suffix = "" if not existing or existing.endswith("\n") else "\n"
        block = f"{existing}{suffix}\n# ContextGit worktrees and repository\n.contextgit/\n"
        try:
            gitignore.write_text(block, encoding="utf-8")
        except OSError:
            return
