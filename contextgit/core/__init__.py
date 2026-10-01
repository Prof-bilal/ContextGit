"""Core library: commits, branches, HEAD, repo operations.

This package is the single source of truth. CLI and API are thin wrappers.
"""

from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    ContextGitError,
    InvalidRefName,
    RepoAlreadyExists,
    RepoNotFound,
)
from contextgit.core.models import Branch, Commit, Message, Tag
from contextgit.core.repo import Repo

__all__ = [
    "Branch",
    "BranchNotFound",
    "Commit",
    "CommitNotFound",
    "ContextGitError",
    "InvalidRefName",
    "Message",
    "Repo",
    "RepoAlreadyExists",
    "RepoNotFound",
    "Tag",
]
