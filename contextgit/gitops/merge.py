"""Merge pre-flight and checkout-free integration of parallel branches."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .repo import Git


@dataclass(frozen=True)
class MergeTreeResult:
    """Outcome of asking git to compute a merge without touching a worktree."""

    tree: str | None
    conflicted_files: list[str]
    output: str

    @property
    def clean(self) -> bool:
        return self.tree is not None


@dataclass(frozen=True)
class MergePreflight:
    """The result of asking git whether two refs can merge cleanly."""

    clean: bool
    conflicted_files: list[str]
    output: str


def _conflict_path(line: str) -> str | None:
    if not line.startswith("CONFLICT ("):
        return None
    marker = "Merge conflict in "
    idx = line.find(marker)
    if idx != -1:
        return line[idx + len(marker) :].strip() or None
    # e.g. "CONFLICT (modify/delete): a/b.txt deleted in X and modified in Y."
    _, _, rest = line.partition(": ")
    first = rest.split(" ", 1)[0].strip()
    return first or None


def merge_tree(project: Path | str, ours: str, theirs: str) -> MergeTreeResult:
    """Compute the merge of `ours` and `theirs` with `git merge-tree --write-tree`.

    Returns the merged tree oid (None on conflict) and the conflicted paths.
    Requires git >= 2.38.
    """
    result = Git(project).run("merge-tree", "--write-tree", ours, theirs, check=False)
    if result.returncode == 0:
        tree = result.stdout.splitlines()[0].strip() if result.stdout.strip() else None
        return MergeTreeResult(tree=tree, conflicted_files=[], output=result.stdout)
    files = {path for line in result.stdout.splitlines() if (path := _conflict_path(line))}
    return MergeTreeResult(tree=None, conflicted_files=sorted(files), output=result.stdout)


def preflight(project: Path | str, ours: str, theirs: str) -> MergePreflight:
    """Ask git whether `ours` and `theirs` merge cleanly."""
    result = merge_tree(project, ours, theirs)
    return MergePreflight(
        clean=result.clean, conflicted_files=result.conflicted_files, output=result.output
    )
