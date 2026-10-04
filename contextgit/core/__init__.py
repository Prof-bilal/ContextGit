"""Core library: commits, branches, HEAD, repo operations.

This package is the single source of truth. CLI and API are thin wrappers.
"""

from contextgit.core.errors import (
    BranchNotFound,
    CommitNotFound,
    ContextGitError,
    GateNotConfigured,
    InvalidMergeResolution,
    InvalidRefName,
    MergeConflict,
    RepoAlreadyExists,
    RepoNotFound,
    ScopeConflict,
    SessionNotFound,
    StagingEmpty,
    StaleMergePreview,
    TaskCycleError,
    TaskDependencyError,
    TaskNotFound,
    TaskNotReviewable,
    TeamNotFound,
    WorkInProgressLimit,
)
from contextgit.core.models import Branch, Commit, Message, Session, Tag
from contextgit.core.repo import Repo

__all__ = [
    "Branch",
    "BranchNotFound",
    "Commit",
    "CommitNotFound",
    "ContextGitError",
    "GateNotConfigured",
    "InvalidMergeResolution",
    "InvalidRefName",
    "MergeConflict",
    "Message",
    "Repo",
    "RepoAlreadyExists",
    "RepoNotFound",
    "ScopeConflict",
    "Session",
    "SessionNotFound",
    "StagingEmpty",
    "StaleMergePreview",
    "Tag",
    "TaskCycleError",
    "TaskDependencyError",
    "TaskNotFound",
    "TaskNotReviewable",
    "TeamNotFound",
    "WorkInProgressLimit",
]
