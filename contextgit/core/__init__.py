"""Core library: commits, branches, HEAD, repo operations.

This package is the single source of truth. CLI and API are thin wrappers.
"""

from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    ContextGitError,
    InvalidMergeResolution,
    InvalidRefName,
    MergeConflict,
    RepoAlreadyExists,
    RepoNotFound,
    SessionNotFound,
    StagingEmpty,
    StaleMergePreview,
)
from contextgit.core.models import Branch, Commit, Message, Session, Tag
from contextgit.core.repo import Repo

__all__ = [
    "Branch",
    "BranchNotFound",
    "Commit",
    "CommitNotFound",
    "ContextGitError",
    "InvalidMergeResolution",
    "InvalidRefName",
    "MergeConflict",
    "Message",
    "Repo",
    "RepoAlreadyExists",
    "RepoNotFound",
    "Session",
    "SessionNotFound",
    "StagingEmpty",
    "StaleMergePreview",
    "Tag",
]
