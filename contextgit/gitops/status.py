"""Per-run code status for the fleet board.

Pure git/filesystem reads: what a run changed, how far it is ahead/behind the
target, whether its branch still merges cleanly, and which other runs touch the
same files. Nothing here mutates the project.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .errors import GitCommandError
from .merge import preflight
from .repo import Git
from .worktree import WorktreeManager


class WorkspaceStatus(BaseModel):
    """Everything the UI needs about one run's code state."""

    session_id: str
    worktree_path: str | None = None
    git_branch: str | None = None
    base_commit: str | None = None
    target: str | None = None
    changed_files: list[str] = Field(default_factory=list)
    ahead: int = 0
    behind: int = 0
    dirty: bool = False
    clean: bool = True
    conflicts: list[str] = Field(default_factory=list)


class FleetEntry(BaseModel):
    """One run in the fleet board."""

    session_id: str
    name: str
    agent: str | None = None
    status: str = "idle"
    branch: str
    git_branch: str | None = None
    worktree_path: str | None = None
    changed_files: list[str] = Field(default_factory=list)
    ahead: int = 0
    behind: int = 0
    clean: bool = True
    overlaps: list[str] = Field(default_factory=list)


def _resolve_target(project_path: str, target: str | None) -> str:
    if target:
        return target
    branch = Git(project_path).current_branch()
    return branch or "HEAD"


def _ahead_behind(project_path: str, target: str, branch: str) -> tuple[int, int]:
    out = Git(project_path).run(
        "rev-list", "--left-right", "--count", f"{target}...{branch}", check=False
    ).stdout.split()
    if len(out) != 2:
        return 0, 0
    try:
        behind, ahead = int(out[0]), int(out[1])
    except ValueError:
        return 0, 0
    return ahead, behind


def workspace_status(
    *,
    session_id: str,
    worktree_path: str | None,
    base_commit: str | None = None,
    git_branch: str | None = None,
    target: str | None = None,
) -> WorkspaceStatus:
    """Read one run's code state. Sessions without a worktree report empty."""
    status = WorkspaceStatus(
        session_id=session_id,
        worktree_path=worktree_path,
        git_branch=git_branch,
        base_commit=base_commit,
    )
    if not worktree_path or not git_branch:
        return status
    try:
        manager = WorktreeManager.from_worktree(worktree_path)
        worktree = Git(worktree_path)
        status.target = _resolve_target(str(manager.project), target)
        if base_commit:
            status.changed_files = worktree.changed_files(base_commit)
        status.dirty = worktree.is_dirty()
        status.ahead, status.behind = _ahead_behind(str(manager.project), status.target, git_branch)
        result = preflight(manager.project, status.target, git_branch)
        status.clean = result.clean
        status.conflicts = result.conflicted_files
    except GitCommandError:
        # The worktree was moved or removed, or git is unavailable: report what
        # is known rather than failing the whole fleet request.
        pass
    return status
