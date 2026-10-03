"""Git worktree isolation for parallel agent runs.

ContextGit keeps its conversation DAG in SQLite; this package is only about the
*code* side — one git worktree (and branch) per run, changed-file detection, and
merge pre-flight. It never touches the ContextGit database.
"""

from .errors import (
    DirtyWorktree,
    GitCommandError,
    NotAGitRepo,
    WorktreeExists,
    WorktreeNotFound,
)
from .integrate import IntegrationConflict, IntegrationResult, integrate
from .merge import MergePreflight, MergeTreeResult, merge_tree, preflight
from .repo import CommandResult, Git
from .status import FleetEntry, WorkspaceStatus, workspace_status
from .worktree import WorktreeInfo, WorktreeManager

__all__ = [
    "CommandResult",
    "DirtyWorktree",
    "FleetEntry",
    "Git",
    "GitCommandError",
    "IntegrationConflict",
    "IntegrationResult",
    "MergePreflight",
    "MergeTreeResult",
    "NotAGitRepo",
    "WorkspaceStatus",
    "WorktreeExists",
    "WorktreeInfo",
    "WorktreeManager",
    "WorktreeNotFound",
    "integrate",
    "merge_tree",
    "preflight",
    "workspace_status",
]
