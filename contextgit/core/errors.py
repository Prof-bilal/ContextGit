"""Domain exceptions raised by the core library.

The API layer maps these to HTTP codes in one handler; the CLI prints them
as human-readable errors. Core never raises framework-specific exceptions.
"""


class ContextGitError(Exception):
    """Base class for all domain errors."""


class RepoNotFound(ContextGitError):
    """No ContextGit repository exists at the given path."""


class RepoAlreadyExists(ContextGitError):
    """A ContextGit repository already exists at the given path."""


class CommitNotFound(ContextGitError):
    """The referenced commit id does not exist in the repository."""


class BranchNotFound(ContextGitError):
    """The referenced branch does not exist."""


class InvalidRefName(ContextGitError):
    """A branch or tag name is not allowed."""


class MergeConflict(ContextGitError):
    """A merge cannot be applied until every conflict is explicitly resolved."""


class StaleMergePreview(ContextGitError):
    """A branch moved after its merge preview was generated."""


class InvalidMergeResolution(ContextGitError):
    """A merge resolution refers to an unknown conflict or invalid choice."""


class SessionNotFound(ContextGitError):
    """The referenced session id does not exist."""


class StagingEmpty(ContextGitError):
    """A commit was requested but the session has no staged messages."""


class MergeQueueEntryNotFound(ContextGitError):
    """The referenced merge-queue entry does not exist."""
