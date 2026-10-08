"""Merge a run's branch into a target without touching any checkout.

`git merge-tree --write-tree` builds the merged tree, `git commit-tree` makes
the two-parent commit and `git update-ref` advances the target branch. The
user's working tree is never disturbed, and the compare-and-swap on the ref
keeps the queue safe against concurrent changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .errors import GitCommandError
from .merge import merge_tree
from .repo import Git

# commit-tree needs an identity; override any missing user config.
_IDENTITY = ("-c", "user.name=ContextGit", "-c", "user.email=contextgit@localhost")


class IntegrationConflict(GitCommandError):
    """The branch cannot merge cleanly into the target."""

    def __init__(self, message: str, conflicted_files: list[str]) -> None:
        super().__init__(message)
        self.conflicted_files = conflicted_files


@dataclass(frozen=True)
class IntegrationResult:
    """The merge commit created on the target branch."""

    commit_id: str
    target: str


def _integrate(
    project: Path | str,
    target: str,
    branch: str,
    *,
    message: str,
    target_commit: str | None = None,
) -> IntegrationResult:
    """Merge `branch` into `target` and advance the target ref.

    Raises IntegrationConflict if the merge is not clean.
    """
    git = Git(project)
    merged = merge_tree(project, target, branch)
    if not merged.clean or merged.tree is None:
        raise IntegrationConflict(
            f"'{branch}' does not merge cleanly into '{target}'", merged.conflicted_files
        )
    old = target_commit or git.rev_parse(target)
    commit = git.run(
        *_IDENTITY,
        "commit-tree",
        merged.tree,
        "-p",
        old,
        "-p",
        git.rev_parse(branch),
        "-m",
        message,
    ).stdout.strip()
    git.run("update-ref", f"refs/heads/{target}", commit, old)
    return IntegrationResult(commit_id=commit, target=target)


def integrate(
    project: Path | str, target: str, branch: str, *, message: str, target_commit: str | None = None
) -> IntegrationResult:
    from contextgit.integration.service import project_lock

    with project_lock(str(Path(project).resolve())):
        return _integrate(project, target, branch, message=message, target_commit=target_commit)
